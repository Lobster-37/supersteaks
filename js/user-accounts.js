// SuperSteaks User Account Management System
// Uses Firebase Firestore for cloud-based user management

class UserAccountSystem {
    constructor() {
        this.currentUser = null;
        this.users = {};
        this.db = null;
        this.initializeFirebase();
        this.initializeEventListeners();
        this.checkExistingSession();
    }

    // Initialize Firebase
    async initializeFirebase() {
        // Wait for Firebase to be loaded
        if (typeof firebase === 'undefined') {
            console.log('Firebase not loaded yet, waiting...');
            setTimeout(() => this.initializeFirebase(), 1000);
            return;
        }
        
        try {
            console.log('Initializing Firebase with project:', window.firebaseConfig?.projectId);
            this.db = firebase.firestore();
            this.auth = firebase.auth();
            console.log('Firebase initialized successfully (Firestore + Auth)');
            
            // Test Firebase connection
            try {
                await this.auth.getRedirectResult(); // Test auth connection
                console.log('Firebase Auth connection test successful');
            } catch (authTestError) {
                console.error('Firebase Auth connection test failed:', authTestError);
                if (authTestError.code === 'auth/api-key-not-valid') {
                    console.error('CRITICAL: Invalid Firebase API key! Please check Firebase configuration.');
                }
            }
            
            // Set up auth state listener
            this.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    console.log('Auth state changed - user signed in:', user.email, 'verified:', user.emailVerified);
                    
                    // Update internal current user state
                    try {
                        // Try to get user metadata from Firestore
                        const userDoc = await this.db.collection('users').doc(user.uid).get();
                        if (userDoc.exists) {
                            this.currentUser = {
                                uid: user.uid,
                                email: user.email,
                                emailVerified: user.emailVerified,
                                username: userDoc.data().username || user.email
                            };
                        } else {
                            // Fallback to basic Firebase user info
                            this.currentUser = {
                                uid: user.uid,
                                email: user.email,
                                emailVerified: user.emailVerified,
                                username: user.email
                            };
                        }
                        console.log('Internal currentUser updated:', this.currentUser);
                        
                        // Update UI
                        if (window.updateUIForLoggedInState) {
                            window.updateUIForLoggedInState(this.currentUser);
                        }
                    } catch (error) {
                        console.error('Error updating currentUser from Firebase auth state:', error);
                        // Basic fallback
                        this.currentUser = {
                            uid: user.uid,
                            email: user.email,
                            emailVerified: user.emailVerified,
                            username: user.email
                        };
                    }
                } else {
                    console.log('Auth state changed - user signed out');
                    this.currentUser = null;
                    
                    // Update UI
                    if (window.updateUIForLoggedOutState) {
                        window.updateUIForLoggedOutState();
                    }
                }
            });
            
        } catch (error) {
            console.error('Firebase initialization failed:', error);
            if (error.code === 'auth/api-key-not-valid') {
                console.error('CRITICAL: Invalid Firebase API key! Check Firebase project configuration.');
            }
            // Fallback to localStorage if Firebase fails
            this.db = null;
            this.auth = null;
        }
    }

    // Load users from Firestore or localStorage fallback
    async loadUsers() {
        if (this.db) {
            try {
                const snapshot = await this.db.collection('users').get();
                const users = {};
                snapshot.forEach(doc => {
                    users[doc.id] = doc.data();
                });
                this.users = users;
                console.log('Users loaded from Firestore:', Object.keys(users));
                return users;
            } catch (error) {
                console.error('Error loading users from Firestore:', error);
                // Detect if a browser extension is blocking Firebase network requests
                try {
                    this.handleFirebaseBlocked && this.handleFirebaseBlocked(error);
                } catch (e) {
                    console.error('Error while handling Firebase block detection:', e);
                }
                return this.loadUsersFromLocalStorage();
            }
        } else {
            return this.loadUsersFromLocalStorage();
        }
    }

    // Fallback to localStorage
    loadUsersFromLocalStorage() {
        const usersData = localStorage.getItem('supersteaks_users');
        this.users = usersData ? JSON.parse(usersData) : {};
        return this.users;
    }

    // Save users to Firestore or localStorage fallback
    async saveUsers() {
        if (this.db) {
            try {
                // Save each user document
                const batch = this.db.batch();
                for (const [username, userData] of Object.entries(this.users)) {
                    const userRef = this.db.collection('users').doc(username.toLowerCase());
                    batch.set(userRef, userData);
                }
                await batch.commit();
                console.log('Users saved to Firestore');
            } catch (error) {
                console.error('Error saving to Firestore:', error);
                this.saveUsersToLocalStorage();
            }
        } else {
            this.saveUsersToLocalStorage();
        }
    }

    // Fallback to localStorage
    saveUsersToLocalStorage() {
        localStorage.setItem('supersteaks_users', JSON.stringify(this.users));
    }

    // Save current session
    saveSession(user) {
        localStorage.setItem('supersteaks_session', JSON.stringify({
            username: user.username,
            email: user.email,
            loginTime: Date.now()
        }));
    }

    // Clear session
    clearSession() {
        localStorage.removeItem('supersteaks_session');
    }

    // Check for existing session on page load
    async checkExistingSession() {
        // Load users first
        await this.loadUsers();
        
        // If we have Firebase Auth, let the auth state listener handle the UI
        if (this.auth && this.auth.currentUser) {
            console.log('Firebase user already authenticated, letting auth state listener handle UI');
            return;
        }
        
        const session = localStorage.getItem('supersteaks_session');
        if (session) {
            const sessionData = JSON.parse(session);
            // Session expires after 7 days
            if (Date.now() - sessionData.loginTime < 7 * 24 * 60 * 60 * 1000) {
                this.currentUser = sessionData;
                this.updateUI(true);
                await this.restoreUserTeamAssignments();
                return;
            } else {
                this.clearSession();
            }
        }
        
        // Only set logged-out state if no Firebase user and no valid session
        if (!this.auth || !this.auth.currentUser) {
            this.updateUI(false);
        }
    }

    // Register new user with Firebase Authentication
    async register(username, email, password) {
        // Validation
        if (!username || !email || !password) {
            throw new Error('All fields are required');
        }

        if (username.length < 3) {
            throw new Error('Username must be at least 3 characters');
        }

        if (password.length < 6) {
            throw new Error('Password must be at least 6 characters');
        }

        if (!this.isValidEmail(email)) {
            throw new Error('Please enter a valid email address');
        }

        try {
            // Create user with Firebase Auth
            const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
            const firebaseUser = userCredential.user;
            
            console.log('Firebase user created:', firebaseUser.email, 'UID:', firebaseUser.uid);
            
            // Send email verification
            try {
                await firebaseUser.sendEmailVerification({
                    url: window.location.origin + '/games.html', // URL to redirect to after verification
                });
                console.log('Verification email sent successfully to:', email);
            } catch (emailError) {
                console.error('Failed to send verification email:', emailError);
                throw new Error('Account created but failed to send verification email. Please contact support.');
            }
            
            // Store user metadata in Firestore
            if (this.db) {
                try {
                    await this.db.collection('users').doc(firebaseUser.uid).set({
                        username: username,
                        email: email,
                        registeredDate: new Date().toISOString(),
                        teamAssignments: [],
                        contestsEntered: []
                    });
                    console.log('User metadata stored in Firestore');
                } catch (firestoreError) {
                    console.warn('Failed to save user metadata to Firestore:', firestoreError);
                }
            }
            
            // Important: Sign out the user immediately after registration
            // This prevents auto-login before email verification
            await firebase.auth().signOut();
            console.log('User signed out after registration - must verify email first');
            
            return { 
                username: username, 
                email: email,
                uid: firebaseUser.uid,
                emailVerified: false, // Always false for new accounts
                message: 'Account created! Please check your email and click the verification link before logging in.'
            };
            
        } catch (error) {
            console.error('Firebase registration error:', error);
            
            // Provide user-friendly error messages
            if (error.code === 'auth/email-already-in-use') {
                throw new Error('An account with this email address already exists.');
            } else if (error.code === 'auth/weak-password') {
                throw new Error('Password is too weak. Please choose a stronger password.');
            } else if (error.code === 'auth/invalid-email') {
                throw new Error('Invalid email address format.');
            } else {
                throw new Error(error.message || 'Registration failed. Please try again.');
            }
        }
    }

    // Login user with Firebase Authentication (supports username or email)
    async login(identifier, password) {
        console.log('Firebase login attempt with identifier:', identifier);
        
        if (!identifier || !password) {
            throw new Error('Username/Email and password are required');
        }

        let email = identifier;
        let username = '';

        try {
            // If identifier is not an email, try to find the email by username
            if (!identifier.includes('@')) {
                // For now, if username is provided but Firestore isn't available or fails,
                // provide a helpful message to use email instead
                if (this.db) {
                    try {
                        console.log('Attempting username lookup in Firestore...');
                        const usersSnapshot = await this.db.collection('users').where('username', '==', identifier).get();
                        if (!usersSnapshot.empty) {
                            const userDoc = usersSnapshot.docs[0];
                            email = userDoc.data().email;
                            username = userDoc.data().username;
                            console.log('Username found, mapped to email:', email);
                        } else {
                            throw new Error(`Username "${identifier}" not found in our records. 

Since you created your account recently, please try logging in with your EMAIL ADDRESS instead of your username.

The username lookup feature requires the database to be fully set up.`);
                        }
                    } catch (firestoreError) {
                        console.warn('Firestore username lookup failed:', firestoreError);
                        throw new Error(`Username lookup is currently unavailable. 

Please log in using your EMAIL ADDRESS instead of your username.

Error details: ${firestoreError.message}`);
                    }
                } else {
                    throw new Error(`Username login is currently unavailable. 

Please log in using your EMAIL ADDRESS instead of your username.`);
                }
            } else {
                // If email is provided, extract username from email as fallback
                username = email.split('@')[0];
                console.log('Email provided, using email:', email);
            }

            // Sign in with Firebase Auth using email
            const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
            const firebaseUser = userCredential.user;
            
            console.log('Firebase signin successful for:', email);
            console.log('Email verified status:', firebaseUser.emailVerified);
            console.log('User UID:', firebaseUser.uid);
            
            // IMPORTANT: Reload user to get latest verification status
            await firebaseUser.reload();
            const refreshedUser = firebase.auth().currentUser;
            console.log('After reload - Email verified status:', refreshedUser.emailVerified);
            
            // Check if email is verified (with better error message)
            if (!refreshedUser.emailVerified) {
                // Sign out the unverified user
                await firebase.auth().signOut();
                throw new Error(`Please verify your email address before logging in. 

Check your inbox for an email from Firebase/SuperSteaks and click the verification link. 

If you haven't received the email, try checking your spam folder or contact support.

Email: ${email}`);
            }
            
            console.log('Firebase login successful');
            
            // If we logged in with email but don't have username, try to get it from Firestore
            if (!username || username === email.split('@')[0]) {
                if (this.db) {
                    try {
                        const userDoc = await this.db.collection('users').doc(firebaseUser.uid).get();
                        if (userDoc.exists) {
                            username = userDoc.data().username || email.split('@')[0];
                        }
                    } catch (error) {
                        console.warn('Could not retrieve username from Firestore:', error);
                        username = email.split('@')[0]; // fallback
                    }
                }
            }
            
            this.currentUser = { 
                username: username,
                email: email,
                uid: firebaseUser.uid
            };
            
            this.saveSession(this.currentUser);
            await this.restoreUserTeamAssignments();
            return this.currentUser;
            
        } catch (error) {
            console.error('Firebase login error:', error);
            
            // Provide user-friendly error messages
            if (error.code === 'auth/user-not-found') {
                throw new Error('No account found with this email address.');
            } else if (error.code === 'auth/wrong-password') {
                throw new Error('Incorrect password.');
            } else if (error.code === 'auth/invalid-email') {
                throw new Error('Invalid email address format.');
            } else if (error.code === 'auth/too-many-requests') {
                throw new Error('Too many failed attempts. Please try again later.');
            } else {
                throw new Error(error.message || 'Login failed. Please try again.');
            }
        }
    }

    // Logout user
    logout() {
        this.currentUser = null;
        this.clearSession();
        this.updateUI(false);
    }

    // Simple password hashing (not secure for production!)
    hashPassword(password) {
        let hash = 0;
        for (let i = 0; i < password.length; i++) {
            const char = password.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString();
    }

    // Email validation
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Add team assignment to user
    async addTeamAssignment(contestName, teamName) {
        console.log('=== ADD TEAM ASSIGNMENT START ===');
        console.log('Contest:', contestName);
        console.log('Team:', teamName);
        console.log('Current user:', this.currentUser);
        
        if (!this.currentUser || !this.currentUser.uid) {
            console.error('No current user or UID - cannot save assignment');
            console.log('Current user object:', this.currentUser);
            return;
        }

        const assignment = {
            contest: contestName,
            team: teamName,
            date: new Date().toISOString()
        };
        
        console.log('Assignment object to save:', assignment);

        try {
            // Save to Firestore using user's UID
            if (this.db) {
                console.log('Attempting to save to Firestore...');
                const userRef = this.db.collection('users').doc(this.currentUser.uid);
                console.log('User document reference:', userRef.path);
                
                const userDoc = await userRef.get();
                console.log('User document exists:', userDoc.exists);
                
                let userData = {};
                if (userDoc.exists) {
                    userData = userDoc.data();
                    console.log('Existing user data:', userData);
                }
                
                // Initialize arrays if they don't exist
                if (!userData.teamAssignments) userData.teamAssignments = [];
                if (!userData.contestsEntered) userData.contestsEntered = [];
                
                // Add new assignment
                userData.teamAssignments.push(assignment);
                if (!userData.contestsEntered.includes(contestName)) {
                    userData.contestsEntered.push(contestName);
                }
                
                console.log('Updated user data to save:', userData);
                
                // Update Firestore
                await userRef.set(userData, { merge: true });
                console.log('✅ Assignment saved successfully to Firestore');
                
                // Also save to localStorage as backup
                this.saveAssignmentToLocalStorage(assignment);
                
            } else {
                // Fallback to localStorage only
                console.log('Firestore not available, saving to localStorage only');
                this.saveAssignmentToLocalStorage(assignment);
            }
        } catch (error) {
            console.error('❌ Error saving assignment:', error);
            // Fallback to localStorage
            this.saveAssignmentToLocalStorage(assignment);
        }
        console.log('=== ADD TEAM ASSIGNMENT END ===');
    }
    
    // Save assignment to localStorage as backup
    saveAssignmentToLocalStorage(assignment) {
        if (!this.currentUser) return;
        
        const key = `teamAssignments_${this.currentUser.email}`;
        let assignments = JSON.parse(localStorage.getItem(key) || '[]');
        assignments.push(assignment);
        localStorage.setItem(key, JSON.stringify(assignments));
        console.log('Assignment saved to localStorage as backup');
    }

    // Get user's team assignments from Firestore
    async getUserAssignments() {
        console.log('=== GET USER ASSIGNMENTS START ===');
        
        if (!this.currentUser) {
            console.log('No current user, returning empty array');
            return [];
        }
        
        console.log('Getting assignments for user:', this.currentUser);
        
        try {
            // Try to get from Firestore first
            if (this.db && this.currentUser.uid) {
                console.log('Attempting to load from Firestore with UID:', this.currentUser.uid);
                const userDoc = await this.db.collection('users').doc(this.currentUser.uid).get();
                console.log('Firestore user document exists:', userDoc.exists);
                
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    console.log('Firestore user data:', userData);
                    const assignments = userData.teamAssignments || [];
                    console.log('✅ Loaded assignments from Firestore:', assignments);
                    console.log('=== GET USER ASSIGNMENTS END (Firestore) ===');
                    return assignments;
                } else {
                    console.log('User document does not exist in Firestore');
                }
            } else {
                console.log('Firestore not available or no UID');
                console.log('this.db:', !!this.db);
                console.log('this.currentUser.uid:', this.currentUser.uid);
            }
            
            // Fallback to localStorage
            const key = `teamAssignments_${this.currentUser.email}`;
            console.log('Falling back to localStorage with key:', key);
            const assignments = JSON.parse(localStorage.getItem(key) || '[]');
            console.log('✅ Loaded assignments from localStorage:', assignments);
            console.log('=== GET USER ASSIGNMENTS END (localStorage) ===');
            return assignments;
            
        } catch (error) {
            console.error('❌ Error loading assignments:', error);
            
            // Final fallback to localStorage
            const key = `teamAssignments_${this.currentUser.email}`;
            const fallbackAssignments = JSON.parse(localStorage.getItem(key) || '[]');
            console.log('Final fallback assignments:', fallbackAssignments);
            console.log('=== GET USER ASSIGNMENTS END (error fallback) ===');
            return fallbackAssignments;
        }
    }

    // Get all users and their team assignments (public data only)
    getAllTeamAssignments() {
        const allTeams = [];
        for (let userKey in this.users) {
            const user = this.users[userKey];
            if (user.teamAssignments && user.teamAssignments.length > 0) {
                user.teamAssignments.forEach(assignment => {
                    allTeams.push({
                        username: user.username,
                        team: assignment.team,
                        contest: assignment.contest,
                        date: assignment.date
                    });
                });
            }
        }
        // Sort by date (newest first)
        return allTeams.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    // Get team assignments for a specific contest
    getTeamAssignmentsByContest(contestName) {
        const allTeams = this.getAllTeamAssignments();
        return allTeams.filter(assignment => assignment.contest === contestName);
    }

    // Get list of teams already assigned for a specific contest
    getAssignedTeamsForContest(contestName) {
        const assignments = this.getTeamAssignmentsByContest(contestName);
        return assignments.map(assignment => assignment.team);
    }

    // Check if a team is already assigned for a specific contest
    isTeamAssigned(contestName, teamName) {
        const assignedTeams = this.getAssignedTeamsForContest(contestName);
        return assignedTeams.includes(teamName);
    }

    // Get available teams for a contest (teams not yet assigned)
    getAvailableTeamsForContest(contestName, allPossibleTeams) {
        const assignedTeams = this.getAssignedTeamsForContest(contestName);
        return allPossibleTeams.filter(team => !assignedTeams.includes(team.name));
    }

    // Refresh data from cloud (for teams page)
    async refreshFromCloud() {
        console.log('Refreshing data from cloud...');
        await this.loadUsers();
        return this.getAllTeamAssignments();
    }

    // Update UI based on login status
    updateUI(isLoggedIn) {
        const authButtons = document.getElementById('auth-buttons');
        const userInfo = document.getElementById('user-info');
        const usernameDisplay = document.getElementById('username-display');

        console.log('UpdateUI called:', { isLoggedIn, currentUser: this.currentUser });
        console.log('Elements found:', { authButtons: !!authButtons, userInfo: !!userInfo, usernameDisplay: !!usernameDisplay });

        if (isLoggedIn && this.currentUser) {
            if (authButtons) {
                authButtons.classList.add('hidden');
                console.log('Auth buttons hidden');
            }
            if (userInfo) {
                userInfo.classList.remove('hidden');
                console.log('User info shown');
            }
            if (usernameDisplay) {
                usernameDisplay.textContent = this.currentUser.username;
                console.log('Username display updated:', this.currentUser.username);
            }
            
            // Restore team assignments when UI is updated for logged-in user
            setTimeout(() => {
                console.log('Calling restoreUserTeamAssignments from updateUI');
                this.restoreUserTeamAssignments();
            }, 500); // Small delay to ensure page is ready
        } else {
            if (authButtons) {
                authButtons.classList.remove('hidden');
                console.log('Auth buttons shown');
            }
            if (userInfo) {
                userInfo.classList.add('hidden');
                console.log('User info hidden');
            }
        }
    }

    // Detect and show a user-visible banner when Firebase network calls are blocked by extensions
    handleFirebaseBlocked(error) {
        // Basic detection from error message or common network error patterns
        const msg = (error && (error.message || '')).toString().toLowerCase();
        const likelyBlocked = msg.includes('blocked') || msg.includes('err_blocked_by_client') || msg.includes('networkerror') || msg.includes('fetch') || msg.includes('typeerror');

        if (!likelyBlocked) return;

        // Don't add multiple banners
        if (document.getElementById('firebase-blocked-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'firebase-blocked-banner';
        banner.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;padding:12px;text-align:center;background:#fff3cd;border-bottom:1px solid #ffeeba;color:#856404;font-family:Inter,system-ui,sans-serif;';
        banner.innerHTML = `Firebase network requests appear to be blocked by a browser extension (e.g. an ad-blocker). This prevents login and cloud sync. Please disable or whitelist this site and refresh the page. <button id="fb-unblock-info" style="margin-left:8px;padding:6px 10px;background:#fff;border:1px solid #856404;border-radius:6px;cursor:pointer;">How to fix</button>`;
        document.body.appendChild(banner);

        document.getElementById('fb-unblock-info').addEventListener('click', () => {
            const info = `Try one of these options:\n\n` +
                `1) Open an Incognito/Private window (extensions are usually disabled there) and try the site again.\n` +
                `2) Disable or pause your ad-blocker/privacy extension for this site.\n` +
                `3) Whitelist these domains in your extension: firestore.googleapis.com, firebase.googleapis.com, gstatic.com, googleapis.com, firebaseapp.com.\n\n` +
                `If you need help, tell me which browser and which ad-blocker you're using and I can give exact steps.`;
            alert(info);
        });
    }

    // Initialize event listeners
    initializeEventListeners() {
        // Wait for DOM to be ready
        document.addEventListener('DOMContentLoaded', () => {
            this.setupModalListeners();
        });

        // If DOM is already ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.setupModalListeners();
            });
        } else {
            this.setupModalListeners();
        }
    }

    setupModalListeners() {
        // Modal controls
        const loginBtn = document.getElementById('login-btn');
        const registerBtn = document.getElementById('register-btn');
        const closeModal = document.getElementById('close-modal');
        const authModal = document.getElementById('auth-modal');
        const switchToRegister = document.getElementById('switch-to-register');
        const switchToLogin = document.getElementById('switch-to-login');
        const logoutBtn = document.getElementById('logout-btn');

        // Open modal for login
        loginBtn?.addEventListener('click', () => {
            this.showModal('login');
        });

        // Open modal for register
        registerBtn?.addEventListener('click', () => {
            this.showModal('register');
        });

        // Close modal
        closeModal?.addEventListener('click', () => {
            this.hideModal();
        });

        // Close modal on outside click
        authModal?.addEventListener('click', (e) => {
            if (e.target === authModal) {
                this.hideModal();
            }
        });

        // Switch between forms
        switchToRegister?.addEventListener('click', () => {
            this.showModal('register');
        });

        switchToLogin?.addEventListener('click', () => {
            this.showModal('login');
        });

        // Logout
        logoutBtn?.addEventListener('click', () => {
            console.log('Logout button clicked');
            this.logout();
        });

        // Also try to find logout buttons on the page load
        setTimeout(() => {
            const logoutBtn2 = document.getElementById('logout-btn');
            if (logoutBtn2 && !logoutBtn) {
                console.log('Found logout button on delayed search');
                logoutBtn2.addEventListener('click', () => {
                    console.log('Logout button clicked (delayed)');
                    this.logout();
                });
            }
        }, 1000);

        // Form submissions
        const loginForm = document.getElementById('login-form-element');
        const registerForm = document.getElementById('register-form-element');

        loginForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        registerForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleRegister();
        });
    }

    // Show modal
    showModal(type = 'login') {
        const authModal = document.getElementById('auth-modal');
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');

        if (type === 'login') {
            loginForm?.classList.remove('hidden');
            registerForm?.classList.add('hidden');
        } else {
            loginForm?.classList.add('hidden');
            registerForm?.classList.remove('hidden');
        }

        authModal?.classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }

    // Hide modal
    hideModal() {
        const authModal = document.getElementById('auth-modal');
        authModal?.classList.add('hidden');
        document.body.style.overflow = ''; // Restore scrolling
        this.clearFormErrors();
    }

    // Handle login form submission
    async handleLogin() {
        const identifier = document.getElementById('login-identifier')?.value;
        const password = document.getElementById('login-password')?.value;

        try {
            const user = await this.login(identifier, password);
            this.updateUI(true);
            this.hideModal();
            this.showSuccess('Login successful! Welcome back, ' + user.username + '!');
        } catch (error) {
            this.showError(error.message, 'login');
        }
    }

    // Handle register form submission
    async handleRegister() {
        const username = document.getElementById('register-username')?.value;
        const email = document.getElementById('register-email')?.value;
        const password = document.getElementById('register-password')?.value;

        try {
            const result = await this.register(username, email, password);
            
            // Don't auto-login - user must verify email first
            this.hideModal();
            
            // Show success message about email verification
            const message = result.message || `Account created successfully! 

A verification email has been sent to ${email}. 

Please check your inbox and click the verification link before logging in.

If you don't see the email, check your spam folder.`;
            
            this.showSuccess(message);
        } catch (error) {
            this.showError(error.message, 'register');
        }
    }

    // Show error message
    showError(message, formType) {
        this.clearFormErrors();
        const errorDiv = document.createElement('div');
        errorDiv.className = 'bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4';
        errorDiv.innerHTML = `<strong>Error:</strong> ${message}`;
        errorDiv.id = 'form-error';

        const form = document.getElementById(formType === 'login' ? 'login-form' : 'register-form');
        form?.insertBefore(errorDiv, form.firstChild);
    }

    // Show success message
    showSuccess(message) {
        // Create and show success notification
        const successDiv = document.createElement('div');
        successDiv.className = 'fixed top-4 right-4 bg-green-100 border border-green-400 text-green-700 px-6 py-4 rounded-lg shadow-lg z-50 max-w-md';
        
        // Handle multi-line messages
        const formattedMessage = message.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
        successDiv.innerHTML = `<strong>Success!</strong><br>${formattedMessage}`;

        document.body.appendChild(successDiv);

        // Remove after 8 seconds for longer messages
        setTimeout(() => {
            successDiv.remove();
        }, 8000);
    }

    // Clear form errors
    clearFormErrors() {
        const existingError = document.getElementById('form-error');
        existingError?.remove();
    }

    // Get current user info
    getCurrentUser() {
        return this.currentUser;
    }

    // Check if user is logged in
    isLoggedIn() {
        return this.currentUser !== null;
    }

    // Restore user's team assignments when they log back in
    async restoreUserTeamAssignments() {
        console.log('=== RESTORE TEAM ASSIGNMENTS START ===');
        console.log('Current user:', this.currentUser);
        
        if (!this.currentUser) {
            console.log('No current user, skipping restore');
            return;
        }

        const assignments = await this.getUserAssignments();
        console.log('Restoring assignments for user:', this.currentUser.username, assignments);
        
        // If we're on the games page, check if user has a team for the current contest
        if (window.location.pathname.includes('games.html') || document.getElementById('assigned-team')) {
            const contestName = 'Champions League Draw'; // Match the contest name used in enterDraw
            console.log('Looking for assignment with contest name:', contestName);
            const existingAssignment = assignments.find(assignment => assignment.contest === contestName);
            
            if (existingAssignment) {
                console.log('Found existing assignment:', existingAssignment);
                this.displaySavedTeam(existingAssignment);
            } else {
                console.log('No existing assignment found for contest:', contestName);
                console.log('Available assignments:', assignments.map(a => a.contest));
            }
        } else {
            console.log('Not on games page, current path:', window.location.pathname);
        }
        console.log('=== RESTORE TEAM ASSIGNMENTS END ===');
    }

    // Display a saved team assignment on the games page
    displaySavedTeam(assignment) {
        const assignedTeamEl = document.getElementById('assigned-team');
        const enterButton = document.getElementById('enter-button');
        const messageArea = document.getElementById('message-area');
        const teamContainer = document.getElementById('team-container');

        if (assignedTeamEl && enterButton && messageArea) {
            // Update the team display
            assignedTeamEl.textContent = assignment.team;
            assignedTeamEl.classList.remove('text-gray-600');
            assignedTeamEl.classList.add('text-green-600');

            // Disable the enter button
            enterButton.disabled = true;
            enterButton.textContent = 'Team Already Assigned!';
            enterButton.classList.remove('bg-yellow-500', 'hover:bg-yellow-400');
            enterButton.classList.add('bg-gray-400', 'cursor-not-allowed');

            // Update message
            messageArea.textContent = `Welcome back! You're supporting ${assignment.team} in this contest.`;
            messageArea.classList.remove('text-indigo-600');
            messageArea.classList.add('text-green-600');

            // Update team container styling if available
            if (teamContainer) {
                teamContainer.style.borderColor = '#10B981'; // Green border for assigned team
            }

            console.log(`Restored team assignment: ${assignment.team} for contest: ${assignment.contest}`);
        }
    }
}

// Initialize the user account system
const userSystem = new UserAccountSystem();

// Make it globally available
window.SuperSteaksAuth = userSystem;