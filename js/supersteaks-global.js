/**
 * SuperSteaks Global System
 * Firebase Authentication and Firestore integration for worldwide gameplay
 */

// Global error handler for catching Firebase auth.ts errors
if (typeof window !== 'undefined') {
    const injectDesktopAuthLayoutFix = () => {
        try {
            if (document.getElementById('supersteaks-auth-layout-fix')) return;
            const style = document.createElement('style');
            style.id = 'supersteaks-auth-layout-fix';
            style.textContent = `
                @media (min-width: 640px) {
                    #user-account-section { position: relative; }
                    #user-account-section > div:first-child {
                        position: absolute !important;
                        top: 1rem !important;
                        right: 1rem !important;
                        width: 176px;
                    }
                    #user-account-section #user-info {
                        position: absolute !important;
                        top: 1rem !important;
                        right: 1rem !important;
                    }
                    #user-account-section #auth-skeleton .flex {
                        justify-content: flex-end !important;
                    }
                    #user-account-section #auth-buttons .flex {
                        justify-content: flex-end !important;
                    }
                }
            `;
            (document.head || document.documentElement).appendChild(style);
        } catch (error) {
            console.warn('Could not inject desktop auth layout fix:', error);
        }
    };

    injectDesktopAuthLayoutFix();

    window.addEventListener('error', function(e) {
        if (e.message && (e.message.includes('Cannot destructure property') || (e.filename && e.filename.includes('auth.ts')))) {
            console.warn('Caught Firebase/destructuring error in SuperSteaks Global:', e.message, 'at', e.filename, ':', e.lineno);
            // Don't let Firebase auth errors crash the page
            e.preventDefault();
            return true;
        }
    });
    
    // Additional unhandled promise rejection handler for Firebase
    window.addEventListener('unhandledrejection', function(event) {
        if (event.reason && event.reason.toString().includes('auth')) {
            console.warn('Caught unhandled Firebase auth promise rejection in SuperSteaks Global:', event.reason);
            event.preventDefault();
        }
    });
}

class SuperSteaksGlobal {
    constructor() {
        this.auth = null;
        this.firestore = null;
        this.currentUser = null;
        this.initialized = false;
        
        // Initialize Firebase services
        this.init();
        this.initNavScrollPersistence();
        this.initProfileDropdownCloseBehavior();
        this.injectMobileHeaderCompaction();
        this.initMoreMenuFallback();
    }
    

    async init() {
        try {
            console.log('Initializing SuperSteaks Global system...');
            // Remove auth-ready before auth state is determined
            document.body.classList.remove('auth-ready');
            // Initialize Firebase Auth and Firestore
            this.auth = firebase.auth();
            this.firestore = firebase.firestore();
            this.functions = firebase.functions();
            // Set up auth state listener with error protection
            try {
                this.auth.onAuthStateChanged((user) => {
                    try {
                        this.currentUser = user;
                        this.updateUIForAuthState(user);
                        // Add auth-ready after auth state is determined
                        document.body.classList.add('auth-ready');
                    } catch (error) {
                        console.warn('Error in auth state change handler:', error);
                        // Continue execution even if UI update fails
                    }
                });
            } catch (error) {
                console.warn('Error setting up auth state listener:', error);
            }
            this.initialized = true;
            console.log('SuperSteaks Global system initialized successfully');
        } catch (error) {
            console.error('Error initializing SuperSteaks Global:', error);
        }
    }

    initNavScrollPersistence() {
        const setup = () => {
            try {
                const navList = document.querySelector('nav[aria-label="Main navigation"] ul');
                if (!navList) return;

                const storageKey = 'supersteaks:navScroll';
                const getSavedScroll = () => {
                    const saved = window.localStorage.getItem(storageKey);
                    if (saved === null) return null;
                    const parsed = parseInt(saved, 10);
                    return Number.isNaN(parsed) ? null : parsed;
                };

                const applySavedScroll = () => {
                    const savedScroll = getSavedScroll();
                    if (savedScroll === null) return;
                    const maxScroll = Math.max(0, navList.scrollWidth - navList.clientWidth);
                    navList.scrollLeft = Math.max(0, Math.min(savedScroll, maxScroll));
                };

                // Restore early, then re-apply after layout/font settling
                requestAnimationFrame(() => applySavedScroll());
                requestAnimationFrame(() => requestAnimationFrame(() => applySavedScroll()));
                window.setTimeout(applySavedScroll, 150);
                window.addEventListener('load', applySavedScroll, { once: true });
                if (document.fonts && document.fonts.ready) {
                    document.fonts.ready.then(() => applySavedScroll()).catch(() => {});
                }

                navList.addEventListener('scroll', () => {
                    window.localStorage.setItem(storageKey, String(navList.scrollLeft));
                }, { passive: true });

                navList.querySelectorAll('a').forEach((link) => {
                    link.addEventListener('click', () => {
                        window.localStorage.setItem(storageKey, String(navList.scrollLeft));
                    });
                });
            } catch (error) {
                console.warn('Nav scroll persistence setup failed:', error);
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setup, { once: true });
        } else {
            setup();
        }
    }

    initProfileDropdownCloseBehavior() {
        const setup = () => {
            try {
                document.addEventListener('click', (event) => {
                    const dropdown = document.getElementById('profile-dropdown');
                    if (!dropdown || dropdown.classList.contains('hidden')) return;

                    const mobileProfileBtn = document.getElementById('mobile-profile-btn');
                    const profileDropdownBtn = document.getElementById('profile-dropdown-btn');

                    const clickedInsideDropdown = dropdown.contains(event.target);
                    const clickedToggle =
                        (mobileProfileBtn && mobileProfileBtn.contains(event.target)) ||
                        (profileDropdownBtn && profileDropdownBtn.contains(event.target));

                    if (!clickedInsideDropdown && !clickedToggle) {
                        dropdown.classList.add('hidden');
                    }
                });

                document.addEventListener('keydown', (event) => {
                    if (event.key !== 'Escape') return;
                    const dropdown = document.getElementById('profile-dropdown');
                    if (dropdown) {
                        dropdown.classList.add('hidden');
                    }
                });
            } catch (error) {
                console.warn('Profile dropdown close behavior setup failed:', error);
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setup, { once: true });
        } else {
            setup();
        }
    }

    injectMobileHeaderCompaction() {
        const setup = () => {
            try {
                if (document.getElementById('supersteaks-mobile-header-compaction')) return;
                const style = document.createElement('style');
                style.id = 'supersteaks-mobile-header-compaction';
                style.textContent = `
                    @media (max-width: 639px) {
                        nav[aria-label="Main navigation"] {
                            margin-top: -30px !important;
                            position: relative;
                            z-index: 40;
                        }
                        .flex.flex-row.items-center.justify-center.sm\\:block {
                            margin-bottom: -4px !important;
                        }
                    }
                `;
                (document.head || document.documentElement).appendChild(style);
            } catch (error) {
                console.warn('Mobile header compaction setup failed:', error);
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setup, { once: true });
        } else {
            setup();
        }
    }

    initMoreMenuFallback() {
        const setup = () => {
            try {
                const menus = Array.from(document.querySelectorAll('details.more-nav-menu'));
                if (!menus.length) return;

                const closeMenu = (menu) => {
                    const panel = menu.querySelector('div');
                    menu.removeAttribute('open');
                    if (panel) panel.hidden = true;
                };

                const openMenu = (menu) => {
                    menus.forEach((entry) => {
                        if (entry !== menu) closeMenu(entry);
                    });
                    const panel = menu.querySelector('div');
                    menu.setAttribute('open', 'open');
                    if (panel) panel.hidden = false;
                };

                menus.forEach((menu) => {
                    const summary = menu.querySelector('summary');
                    const panel = menu.querySelector('div');
                    if (!summary || !panel) return;

                    panel.hidden = !menu.hasAttribute('open');

                    const toggle = (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (menu.hasAttribute('open')) {
                            closeMenu(menu);
                        } else {
                            openMenu(menu);
                        }
                    };

                    summary.addEventListener('click', toggle);
                    summary.addEventListener('touchend', toggle, { passive: false });

                    panel.querySelectorAll('a').forEach((link) => {
                        link.addEventListener('click', () => closeMenu(menu));
                    });
                });

                document.addEventListener('click', (event) => {
                    const clickedInside = menus.some((menu) => menu.contains(event.target));
                    if (!clickedInside) {
                        menus.forEach((menu) => closeMenu(menu));
                    }
                });

                document.addEventListener('keydown', (event) => {
                    if (event.key === 'Escape') {
                        menus.forEach((menu) => closeMenu(menu));
                    }
                });
            } catch (error) {
                console.warn('More menu fallback setup failed:', error);
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setup, { once: true });
        } else {
            setup();
        }
    }
    
    // Authentication Methods
    async signUp(email, password, displayName) {
        try {
            // Server-side validation
            if (!displayName || displayName.trim().length === 0) {
                throw new Error('Username is required and cannot be empty.');
            }
            
            if (displayName.trim().length < 3) {
                throw new Error('Username must be at least 3 characters long.');
            }
            
            if (displayName.trim().length > 20) {
                throw new Error('Username must be 20 characters or less.');
            }
            
            if (!/^[a-zA-Z0-9._-]+$/.test(displayName.trim())) {
                throw new Error('Username can only contain letters, numbers, dots, underscores, and hyphens.');
            }
            
            if (!email || email.trim().length === 0) {
                throw new Error('Email is required.');
            }
            
            if (!password || password.length < 6) {
                throw new Error('Password must be at least 6 characters long.');
            }
            
            const cleanDisplayName = displayName.trim();
            const cleanEmail = email.trim();
            
            const userCredential = await this.auth.createUserWithEmailAndPassword(cleanEmail, password);
            const user = userCredential.user;
            
            // Update profile with display name
            await user.updateProfile({ displayName: cleanDisplayName });
            
            // Create user document in Firestore
            await this.firestore.collection('users').doc(user.uid).set({
                uid: user.uid,
                email: cleanEmail,
                displayName: cleanDisplayName,
                createdAt: new Date(),
                teamAssignments: []
            });
            
            console.log('User signed up successfully:', cleanDisplayName);
            return { success: true, user };
            
        } catch (error) {
            console.error('Sign up error:', error);
            return { success: false, error: error.message };
        }
    }
    
    async signIn(emailOrUsername, password) {
        try {
            let email = emailOrUsername;
            
            // If input doesn't contain @, treat it as username and find the email
            if (!emailOrUsername.includes('@')) {
                console.log('Input appears to be username, looking up email:', emailOrUsername);
                
                // Query Firestore to find user by username
                const usersRef = this.firestore.collection('users');
                const snapshot = await usersRef.where('username', '==', emailOrUsername).get();
                
                if (snapshot.empty) {
                    return { success: false, error: 'Username not found' };
                }
                
                // Get the email from the user document
                const userDoc = snapshot.docs[0];
                email = userDoc.data().email;
                console.log('Found email for username:', email);
            }
            
            const userCredential = await this.auth.signInWithEmailAndPassword(email, password);
            const user = userCredential.user;
            
            console.log('User signed in successfully. Current displayName:', user.displayName);
            console.log('User email:', user.email);
            
            // Debug user profile data
            console.log('=== USER PROFILE DEBUG ===');
            console.log('UID:', user.uid);
            console.log('Email:', user.email);
            console.log('DisplayName:', user.displayName);
            console.log('Email prefix:', user.email ? user.email.split('@')[0] : 'no email');
            console.log('==========================')
            
            return { success: true, user: userCredential.user };
            
        } catch (error) {
            console.error('Sign in error:', error);
            return { success: false, error: error.message };
        }
    }
    
    async signOut() {
        try {
            await this.auth.signOut();
            console.log('User signed out successfully');
            return { success: true };
            
        } catch (error) {
            console.error('Sign out error:', error);
            return { success: false, error: error.message };
        }
    }

    // Alias methods for compatibility with HTML
    async login(email, password) {
        return this.signIn(email, password);
    }

    async register(email, password, displayName) {
        return this.signUp(email, password, displayName);
    }

    async logout() {
        return this.signOut();
    }

    checkAuthState(callback) {
        if (this.auth) {
            try {
                this.auth.onAuthStateChanged((user) => {
                    try {
                        if (callback && typeof callback === 'function') {
                            callback(user);
                        }
                    } catch (error) {
                        console.warn('Error in checkAuthState callback:', error);
                    }
                });
            } catch (error) {
                console.warn('Error in checkAuthState listener setup:', error);
            }
        }
    }
    
    async resetPassword(email) {
        try {
            await this.auth.sendPasswordResetEmail(email);
            console.log('Password reset email sent to:', email);
            return { success: true };
            
        } catch (error) {
            console.error('Password reset error:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Team Assignment Methods
    async enterDraw(contestName) {
        if (!this.currentUser) {
            return { success: false, error: 'User not authenticated' };
        }
        
        try {
            // Check if user already has assignment
            const existingAssignment = await this.getUserAssignment(contestName);
            if (existingAssignment) {
                return { 
                    success: false, 
                    error: `You already have ${existingAssignment.team} assigned for this contest!` 
                };
            }
            
            // Get all existing assignments to find available teams
            const allAssignments = await this.getAllTeamAssignments();
            const contestAssignments = allAssignments.filter(a => a.contest === contestName);
            const assignedTeams = contestAssignments.map(a => a.team);
            
            // Get available teams
            const availableTeams = this.getAvailableTeams(assignedTeams);
            
            if (availableTeams.length === 0) {
                return { 
                    success: false, 
                    error: 'Sorry! All teams have been assigned. Contest is full!' 
                };
            }
            
            // Select random team
            const selectedTeam = availableTeams[Math.floor(Math.random() * availableTeams.length)];
            
            // Create assignment document
            const assignmentData = {
                userId: this.currentUser.uid,
                username: this.currentUser.displayName || this.currentUser.email.split('@')[0],
                email: this.currentUser.email,
                contest: contestName,
                team: selectedTeam.name,
                teamData: selectedTeam,
                assignedAt: new Date()
            };
            
            await this.firestore.collection('teamAssignments').add(assignmentData);
            
            return { 
                success: true, 
                team: selectedTeam,
                remainingTeams: availableTeams.length - 1
            };
            
        } catch (error) {
            console.error('Error entering draw:', error);
            return { success: false, error: 'Failed to enter draw. Please try again.' };
        }
    }
    
    // Tournament-based team assignment via Cloud Function
    async joinTournament(tournamentId) {
        if (!this.currentUser) {
            return { success: false, error: 'User not authenticated' };
        }
        
        try {
            // Call Cloud Function to atomically join tournament
            const joinTournamentFunction = this.functions.httpsCallable('joinTournament');
            const result = await joinTournamentFunction({
                tournamentId: tournamentId
            });
            
            if (result.data && result.data.assignment) {
                return {
                    success: true,
                    assignment: result.data.assignment,
                    lobby: result.data.lobby
                };
            } else {
                return { 
                    success: false, 
                    error: result.data?.error || 'Failed to join tournament' 
                };
            }
        } catch (error) {
            console.error('Error joining tournament:', error);
            let errorMessage = 'Failed to join tournament. Please try again.';
            
            // Handle specific error codes
            if (error.code === 'unauthenticated') {
                errorMessage = 'Please log in first';
            } else if (error.code === 'not-found') {
                errorMessage = 'Tournament not found';
            } else if (error.code === 'already-exists') {
                errorMessage = 'You are already registered for this tournament';
            } else if (error.code === 'unavailable') {
                errorMessage = 'No teams available in this tournament';
            }
            
            return { success: false, error: errorMessage };
        }
    }
    
    async getAllTeamAssignments() {
        try {
            const snapshot = await this.firestore
                .collection('teamAssignments')
                .orderBy('assignedAt', 'desc')
                .get();
                
            const assignments = [];
            snapshot.forEach(doc => {
                assignments.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            return assignments;
            
        } catch (error) {
            console.error('Error getting team assignments:', error);
            return [];
        }
    }
    
    async getUserAssignment(contestName) {
        if (!this.currentUser) return null;
        
        try {
            const snapshot = await this.firestore
                .collection('teamAssignments')
                .where('userId', '==', this.currentUser.uid)
                .where('contest', '==', contestName)
                .limit(1)
                .get();
            
            if (snapshot.empty) return null;
            
            return {
                id: snapshot.docs[0].id,
                ...snapshot.docs[0].data()
            };
            
        } catch (error) {
            console.error('Error getting user assignment:', error);
            return null;
        }
    }
    
    // Helper Methods
    getAvailableTeams(assignedTeams) {
        // This would typically be fetched from Firestore or passed in
        // For now, using the teams array from games.html
        const allTeams = [
            { name: "Ajax", pattern: "ajax-stripe", borderColor: "#D2122E" },
            { name: "Arsenal", color: "#EF0107", borderColor: "#FFFFFF" },
            { name: "Atalanta", pattern: "stripes-vertical-blue-black", borderColor: "#1E63B0" },
            { name: "Athletic Club", pattern: "stripes-vertical-red-white", borderColor: "#EE2523" },
            { name: "Atlético Madrid", pattern: "stripes-vertical-red-white", borderColor: "#CE3524" },
            { name: "Barcelona", pattern: "stripes-vertical-blue-garnet", borderColor: "#A50044" },
            { name: "Bayer Leverkusen", color: "#000000", borderColor: "#E32221" },
            { name: "Bayern München", color: "#DC052D", borderColor: "#0066B2" },
            { name: "Benfica", color: "#E20E0E", borderColor: "#FFFFFF" },
            { name: "Bodø/Glimt", color: "#FFD700", borderColor: "#000000" },
            { name: "Borussia Dortmund", color: "#FDE100", borderColor: "#000000" },
            { name: "Chelsea", color: "#034694", borderColor: "#FFFFFF" },
            { name: "Club Brugge", pattern: "stripes-vertical-blue-black", borderColor: "#0032A0" },
            { name: "Copenhagen", color: "#FFFFFF", borderColor: "#1F4E79" },
            { name: "Eintracht Frankfurt", color: "#000000", borderColor: "#E1001C" },
            { name: "Galatasaray", pattern: "diagonal-half-yellow-red", borderColor: "#FFD700" },
            { name: "Inter Milan", pattern: "stripes-vertical-blue-black", borderColor: "#0068A8" },
            { name: "Juventus", pattern: "stripes-vertical-black-white", borderColor: "#000000" },
            { name: "Kairat Almaty", pattern: "stripes-vertical-yellow-black", borderColor: "#FFD700" },
            { name: "Liverpool", color: "#C8102E", borderColor: "#FFD700" },
            { name: "Manchester City", color: "#6CABDD", borderColor: "#FFFFFF" },
            { name: "Marseille", color: "#FFFFFF", borderColor: "#009EDB" },
            { name: "Monaco", pattern: "diagonal-half-red-white", borderColor: "#C8102E" },
            { name: "Napoli", color: "#87CEEB", borderColor: "#FFFFFF" },
            { name: "Newcastle United", pattern: "stripes-vertical-black-white", borderColor: "#000000" },
            { name: "Olympiacos", pattern: "stripes-vertical-red-white", borderColor: "#DC143C" },
            { name: "Paris Saint-Germain", color: "#004170", borderColor: "#FFD700" },
            { name: "Real Madrid", color: "#FFFFFF", borderColor: "#FFD700" },
            { name: "Slavia Praha", pattern: "stripes-vertical-red-white", borderColor: "#DC143C" },
            { name: "Sporting CP", color: "#006633", borderColor: "#FFFFFF" }
        ];
        
        return allTeams.filter(team => !assignedTeams.includes(team.name));
    }
    
    updateUIForAuthState(user) {
        // This method will be called whenever auth state changes
        // Each page can override this to update their specific UI elements
        if (user) {
            console.log('User authenticated:', user.displayName || user.email);
            this.showAuthenticatedUI(user);
        } else {
            console.log('User not authenticated');
            this.showUnauthenticatedUI();
        }
    }
    
    showAuthenticatedUI(user) {
        // Update all pages to show authenticated state
        const authButtons = document.getElementById('auth-buttons');
        const userInfo = document.getElementById('user-info');
        const usernameDisplay = document.getElementById('username-display');
        const usernameDisplayMobile = document.getElementById('username-display-mobile');
        const authSkeleton = document.getElementById('auth-skeleton');

        document.body.classList.add('auth-ready', 'logged-in');
        document.body.classList.remove('logged-out');

        if (authButtons) {
            authButtons.classList.add('hidden');
            authButtons.style.display = 'none';
        }
        if (userInfo) {
            userInfo.classList.remove('hidden');
            userInfo.style.display = '';
        }
        if (authSkeleton) {
            authSkeleton.classList.add('hidden');
            authSkeleton.style.display = 'none';
        }
        let username = user.displayName;
        if (!username && user.email) {
            username = user.email.split('@')[0];
        }

        if (username) {
            if (usernameDisplay) {
                usernameDisplay.textContent = username;
            }
            if (usernameDisplayMobile) {
                usernameDisplayMobile.textContent = username;
            }
        }

        maybePromptForPushNotifications(user);
    }
    
    showUnauthenticatedUI() {
        // Update all pages to show unauthenticated state
        const authButtons = document.getElementById('auth-buttons');
        const userInfo = document.getElementById('user-info');
        const authSkeleton = document.getElementById('auth-skeleton');

        document.body.classList.add('auth-ready', 'logged-out');
        document.body.classList.remove('logged-in');

        if (authButtons) {
            authButtons.classList.remove('hidden');
            authButtons.style.display = '';
        }
        if (userInfo) {
            userInfo.classList.add('hidden');
            userInfo.style.display = 'none';
        }
        if (authSkeleton) {
            authSkeleton.classList.add('hidden');
            authSkeleton.style.display = 'none';
        }
    }
    
    // Utility Methods
    isAuthenticated() {
        return !!this.currentUser;
    }
    
    getCurrentUser() {
        return this.currentUser;
    }
    
    getUserDisplayName() {
        if (!this.currentUser) return null;
        
        let username = this.currentUser.displayName;
        if (!username && this.currentUser.email) {
            username = this.currentUser.email.split('@')[0];
        }
        return username;
    }
}

// Initialize global SuperSteaks system
let superSteaksGlobal = null;
let pushPromptShown = false;
let appVersionPromptShown = false;
let messagingScriptPromise = null;
let pushTokenSyncInFlight = false;

const WEB_PUSH_VAPID_KEY = window.SUPERSTEAKS_VAPID_KEY || '';
const APP_VERSION_NOTICE_STORAGE_KEY = 'supersteaks:appVersionNoticeSeenAt';
const APP_VERSION_NOTICE_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 14;

function createPwaNotice({ id = 'pwa-notice', message, buttonLabel, onButtonClick, dismissible = true, dismissLabel = 'Dismiss', onDismiss }) {
    const existing = document.getElementById(id);
    if (existing) {
        existing.remove();
    }

    const notice = document.createElement('div');
    notice.id = id;
    notice.style.position = 'fixed';
    notice.style.left = '16px';
    notice.style.right = '16px';
    notice.style.bottom = '16px';
    notice.style.zIndex = '9999';
    notice.style.background = '#1f2937';
    notice.style.color = '#ffffff';
    notice.style.borderRadius = '12px';
    notice.style.padding = '12px 14px';
    notice.style.display = 'flex';
    notice.style.alignItems = 'center';
    notice.style.justifyContent = 'space-between';
    notice.style.gap = '12px';
    notice.style.boxShadow = '0 10px 24px rgba(0,0,0,0.28)';

    const text = document.createElement('span');
    text.textContent = message;
    text.style.fontSize = '14px';
    text.style.lineHeight = '1.4';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const actionButton = document.createElement('button');
    actionButton.textContent = buttonLabel;
    actionButton.style.background = '#fbbf24';
    actionButton.style.color = '#111827';
    actionButton.style.border = 'none';
    actionButton.style.borderRadius = '8px';
    actionButton.style.padding = '8px 10px';
    actionButton.style.fontWeight = '700';
    actionButton.style.cursor = 'pointer';
    actionButton.addEventListener('click', onButtonClick);
    actions.appendChild(actionButton);

    if (dismissible) {
        const dismiss = document.createElement('button');
        dismiss.textContent = dismissLabel;
        dismiss.style.background = 'transparent';
        dismiss.style.color = '#ffffff';
        dismiss.style.border = '1px solid rgba(255,255,255,0.35)';
        dismiss.style.borderRadius = '8px';
        dismiss.style.padding = '8px 10px';
        dismiss.style.cursor = 'pointer';
        dismiss.addEventListener('click', () => {
            if (typeof onDismiss === 'function') {
                onDismiss();
            }
            notice.remove();
        });
        actions.appendChild(dismiss);
    }

    notice.appendChild(text);
    notice.appendChild(actions);
    document.body.appendChild(notice);
}

function loadMessagingSdk() {
    if (firebase.messaging) {
        return Promise.resolve(true);
    }

    if (messagingScriptPromise) {
        return messagingScriptPromise;
    }

    messagingScriptPromise = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://www.gstatic.com/firebasejs/9.15.0/firebase-messaging-compat.js';
        script.onload = () => resolve(!!firebase.messaging);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
    });

    return messagingScriptPromise;
}

async function registerPushTokenForCurrentUser() {
    if (pushTokenSyncInFlight) {
        return false;
    }

    if (!window.superSteaksGlobal || !window.superSteaksGlobal.currentUser) {
        return false;
    }

    if (!('Notification' in window) || Notification.permission !== 'granted') {
        return false;
    }

    if (!('serviceWorker' in navigator)) {
        return false;
    }

    pushTokenSyncInFlight = true;

    try {
        const messagingReady = await loadMessagingSdk();
        if (!messagingReady || !firebase.messaging) {
            return false;
        }

        const registration = await navigator.serviceWorker.getRegistration('/sw.js') || await navigator.serviceWorker.register('/sw.js');
        const messaging = firebase.messaging();

        const getTokenOptions = {
            serviceWorkerRegistration: registration
        };

        if (WEB_PUSH_VAPID_KEY) {
            getTokenOptions.vapidKey = WEB_PUSH_VAPID_KEY;
        }

        const token = await messaging.getToken(getTokenOptions);
        if (!token) {
            return false;
        }

        const savePushToken = firebase.functions().httpsCallable('savePushToken');
        await savePushToken({
            token,
            platform: 'web',
            userAgent: navigator.userAgent
        });

        return true;
    } catch (error) {
        console.warn('Push token registration failed:', error.message || error);
        return false;
    } finally {
        pushTokenSyncInFlight = false;
    }
}

function maybePromptForPushNotifications(user) {
    if (!user || pushPromptShown) {
        return;
    }

    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        return;
    }

    if (Notification.permission === 'granted') {
        registerPushTokenForCurrentUser();
        return;
    }

    if (Notification.permission !== 'default') {
        return;
    }

    pushPromptShown = true;

    createPwaNotice({
        id: 'push-notice',
        message: 'Enable notifications for your team\'s fixtures and results.',
        buttonLabel: 'Enable Alerts',
        onButtonClick: async () => {
            try {
                const permission = await Notification.requestPermission();
                const notice = document.getElementById('push-notice');
                if (notice) {
                    notice.remove();
                }

                if (permission === 'granted') {
                    await registerPushTokenForCurrentUser();
                }
            } catch (error) {
                console.warn('Notification permission flow failed:', error.message || error);
            }
        },
        dismissible: true
    });
}

function maybePromptForAppVersion() {
    if (appVersionPromptShown) {
        return;
    }

    const isStandaloneApp =
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        window.navigator.standalone === true ||
        (typeof document.referrer === 'string' && document.referrer.startsWith('android-app://'));

    if (isStandaloneApp) {
        const existingNotice = document.getElementById('app-version-notice');
        if (existingNotice) {
            existingNotice.remove();
        }
        return;
    }

    let lastSeenAt = null;
    try {
        const saved = window.localStorage.getItem(APP_VERSION_NOTICE_STORAGE_KEY);
        if (saved !== null) {
            const parsed = parseInt(saved, 10);
            if (!Number.isNaN(parsed)) {
                lastSeenAt = parsed;
            }
        }
    } catch (error) {
        console.warn('Could not read app version notice state:', error.message || error);
    }

    if (lastSeenAt && (Date.now() - lastSeenAt) < APP_VERSION_NOTICE_COOLDOWN_MS) {
        return;
    }

    if (document.getElementById('push-notice')) {
        window.setTimeout(maybePromptForAppVersion, 2500);
        return;
    }

    const markSeen = () => {
        try {
            window.localStorage.setItem(APP_VERSION_NOTICE_STORAGE_KEY, String(Date.now()));
        } catch (error) {
            console.warn('Could not persist app version notice state:', error.message || error);
        }
    };

    appVersionPromptShown = true;

    createPwaNotice({
        id: 'app-version-notice',
        message: 'SuperSteaks is available in an app-style experience on mobile and desktop.',
        buttonLabel: 'Further Info',
        onButtonClick: () => {
            markSeen();
            const notice = document.getElementById('app-version-notice');
            if (notice) {
                notice.remove();
            }
            window.location.href = '/how-to-play.html#app-version';
        },
        dismissible: true,
        dismissLabel: 'Close',
        onDismiss: markSeen
    });
}

function ensureAppInfoNavLink() {
    try {
        const navList = document.querySelector('nav[aria-label="Main navigation"] ul');
        if (!navList) {
            return;
        }

        const hasLink = Array.from(navList.querySelectorAll('a')).some((link) => {
            const href = (link.getAttribute('href') || '').toLowerCase();
            return href.includes('how-to-play.html') || href.includes('#app-version');
        });

        if (hasLink) {
            return;
        }

        const listItem = document.createElement('li');
        const anchor = document.createElement('a');
        anchor.href = 'how-to-play.html#app-version';
        anchor.textContent = 'App Info';

        const templateLink = navList.querySelector('a.nav-link');
        if (templateLink) {
            anchor.className = templateLink.className;
        } else {
            anchor.className = 'nav-link px-2 sm:px-3 py-2 rounded-lg transition duration-300 hover:bg-indigo-700 text-sm sm:text-base';
        }

        listItem.appendChild(anchor);
        navList.appendChild(listItem);
    } catch (error) {
        console.warn('Could not ensure App Info nav link:', error.message || error);
    }
}

function ensurePwaHeadTags() {
    if (!document.head) {
        return;
    }

    if (!document.querySelector('link[rel="manifest"]')) {
        const manifestLink = document.createElement('link');
        manifestLink.rel = 'manifest';
        manifestLink.href = '/manifest.json';
        document.head.appendChild(manifestLink);
    }

    if (!document.querySelector('meta[name="theme-color"]')) {
        const themeMeta = document.createElement('meta');
        themeMeta.name = 'theme-color';
        themeMeta.content = '#3730a3';
        document.head.appendChild(themeMeta);
    }

    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
        const appleTouchIcon = document.createElement('link');
        appleTouchIcon.rel = 'apple-touch-icon';
        appleTouchIcon.href = '/images/supersteaks-logo.png';
        document.head.appendChild(appleTouchIcon);
    }
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then((registration) => {
            let refreshing = false;

            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (refreshing) {
                    return;
                }
                refreshing = true;
                window.location.reload();
            });
        }).catch((error) => {
            console.warn('Service worker registration failed:', error);
        });
    });
}

function clearLegacyPwaNotices() {
    ['install-notice', 'update-notice', 'push-cta-btn', 'enable-alerts-fallback'].forEach((id) => {
        const element = document.getElementById(id);
        if (element) {
            element.remove();
        }
    });
}

// Export the class for compatibility
window.SuperSteaks = SuperSteaksGlobal;

// Initialize when Firebase is ready
document.addEventListener('DOMContentLoaded', () => {
    clearLegacyPwaNotices();
    ensurePwaHeadTags();
    ensureAppInfoNavLink();
    registerServiceWorker();
    window.setTimeout(maybePromptForAppVersion, 3000);

    if (window.firebaseReady) {
        superSteaksGlobal = new SuperSteaksGlobal();
        window.superSteaksGlobal = superSteaksGlobal;
        window.SuperSteaks = SuperSteaksGlobal; // Alias for compatibility
    } else {
        // Wait for Firebase to be ready
        const checkFirebase = setInterval(() => {
            if (window.firebaseReady) {
                superSteaksGlobal = new SuperSteaksGlobal();
                window.superSteaksGlobal = superSteaksGlobal;
                window.SuperSteaks = SuperSteaksGlobal; // Alias for compatibility
                clearInterval(checkFirebase);
            }
        }, 100);
    }
});