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
            this.db = firebase.firestore();
            console.log('Firebase initialized successfully');
        } catch (error) {
            console.error('Firebase initialization failed:', error);
            // Fallback to localStorage if Firebase fails
            this.db = null;
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
        
        const session = localStorage.getItem('supersteaks_session');
        if (session) {
            const sessionData = JSON.parse(session);
            // Session expires after 7 days
            if (Date.now() - sessionData.loginTime < 7 * 24 * 60 * 60 * 1000) {
                this.currentUser = sessionData;
                this.updateUI(true);
                this.restoreUserTeamAssignments();
                return;
            } else {
                this.clearSession();
            }
        }
        this.updateUI(false);
    }

    // Register new user
    async register(username, email, password) {
        // Load latest users from cloud
        await this.loadUsers();
        
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

        // Check if user already exists
        if (this.users[username.toLowerCase()]) {
            throw new Error('Username already exists');
        }

        // Check if email already exists
        for (let user of Object.values(this.users)) {
            if (user.email.toLowerCase() === email.toLowerCase()) {
                throw new Error('Email already registered');
            }
        }

        // Create new user
        const newUser = {
            username: username,
            email: email,
            password: this.hashPassword(password), // Simple hash
            registeredDate: new Date().toISOString(),
            teamAssignments: [],
            contestsEntered: []
        };

        this.users[username.toLowerCase()] = newUser;
        await this.saveUsers();

        return { username, email };
    }

    // Login user
    async login(username, password) {
        console.log('Login attempt:', username);
        
        // Load latest users from cloud
        await this.loadUsers();
        console.log('Available users:', Object.keys(this.users));
        
        if (!username || !password) {
            throw new Error('Username and password are required');
        }

        const user = this.users[username.toLowerCase()];
        console.log('Found user:', !!user);
        
        if (!user) {
            console.log('User not found in database');
            throw new Error('Invalid username or password');
        }

        const hashedPassword = this.hashPassword(password);
        console.log('Password check - Stored:', user.password, 'Provided hash:', hashedPassword);
        
        if (user.password !== hashedPassword) {
            console.log('Password mismatch');
            throw new Error('Invalid username or password');
        }

        console.log('Login successful');
        this.currentUser = { username: user.username, email: user.email };
        this.saveSession(this.currentUser);
        this.restoreUserTeamAssignments();
        return this.currentUser;
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
        console.log('addTeamAssignment called:', contestName, teamName);
        console.log('Current user:', this.currentUser);
        
        if (!this.currentUser) {
            console.log('No current user - cannot save assignment');
            return;
        }

        // Load latest users to prevent conflicts
        await this.loadUsers();

        const user = this.users[this.currentUser.username.toLowerCase()];
        console.log('Found user in database:', user);
        
        if (user) {
            const assignment = {
                contest: contestName,
                team: teamName,
                date: new Date().toISOString()
            };
            console.log('Adding assignment:', assignment);
            user.teamAssignments.push(assignment);
            user.contestsEntered.push(contestName);
            await this.saveUsers();
            console.log('Assignment saved successfully to cloud');
        } else {
            console.log('User not found in database');
        }
    }

    // Get user's team assignments
    getUserAssignments() {
        if (!this.currentUser) return [];
        const user = this.users[this.currentUser.username.toLowerCase()];
        return user ? user.teamAssignments : [];
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
        const username = document.getElementById('login-username')?.value;
        const password = document.getElementById('login-password')?.value;

        try {
            const user = await this.login(username, password);
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
            const user = await this.register(username, email, password);
            // Auto-login after registration
            this.currentUser = user;
            this.saveSession(user);
            this.updateUI(true);
            this.hideModal();
            this.showSuccess('Account created successfully! Welcome to SuperSteaks, ' + user.username + '!');
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
        successDiv.className = 'fixed top-4 right-4 bg-green-100 border border-green-400 text-green-700 px-6 py-4 rounded-lg shadow-lg z-50';
        successDiv.innerHTML = `<strong>Success!</strong> ${message}`;

        document.body.appendChild(successDiv);

        // Remove after 5 seconds
        setTimeout(() => {
            successDiv.remove();
        }, 5000);
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
    restoreUserTeamAssignments() {
        if (!this.currentUser) return;

        const assignments = this.getUserAssignments();
        
        // If we're on the games page, check if user has a team for the current contest
        if (window.location.pathname.includes('games.html') || document.getElementById('assigned-team')) {
            const contestName = 'Champions League Draw'; // Match the contest name used in enterDraw
            const existingAssignment = assignments.find(assignment => assignment.contest === contestName);
            
            if (existingAssignment) {
                this.displaySavedTeam(existingAssignment);
            }
        }
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