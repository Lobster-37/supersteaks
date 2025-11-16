/**
 * SuperSteaks Global System
 * Firebase Authentication and Firestore integration for worldwide gameplay
 */

class SuperSteaksGlobal {
    constructor() {
        this.auth = null;
        this.firestore = null;
        this.currentUser = null;
        this.initialized = false;
        
        // Initialize Firebase services
        this.init();
    }
    
    async init() {
        try {
            console.log('Initializing SuperSteaks Global system...');
            
            // Initialize Firebase Auth and Firestore
            this.auth = firebase.auth();
            this.firestore = firebase.firestore();
            
            // Set up auth state listener
            this.auth.onAuthStateChanged((user) => {
                this.currentUser = user;
                this.updateUIForAuthState(user);
            });
            
            this.initialized = true;
            console.log('SuperSteaks Global system initialized successfully');
            
        } catch (error) {
            console.error('Error initializing SuperSteaks Global:', error);
        }
    }
    
    // Authentication Methods
    async signUp(email, password, displayName) {
        try {
            const userCredential = await this.auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;
            
            // Update profile with display name
            await user.updateProfile({ displayName });
            
            // Create user document in Firestore
            await this.firestore.collection('users').doc(user.uid).set({
                uid: user.uid,
                email: user.email,
                displayName: displayName,
                createdAt: new Date(),
                teamAssignments: []
            });
            
            console.log('User signed up successfully:', displayName);
            return { success: true, user };
            
        } catch (error) {
            console.error('Sign up error:', error);
            return { success: false, error: error.message };
        }
    }
    
    async signIn(email, password) {
        try {
            const userCredential = await this.auth.signInWithEmailAndPassword(email, password);
            console.log('User signed in successfully:', userCredential.user.displayName);
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
            // Check if user already has assignment (outside transaction first)
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
        
        if (authButtons) {
            authButtons.classList.add('hidden');
            authButtons.style.display = 'none';
        }
        if (userInfo) {
            userInfo.classList.remove('hidden');
            userInfo.style.display = '';
        }
        if (usernameDisplay) {
            usernameDisplay.textContent = user.displayName || user.email.split('@')[0];
        }
    }
    
    showUnauthenticatedUI() {
        // Update all pages to show unauthenticated state
        const authButtons = document.getElementById('auth-buttons');
        const userInfo = document.getElementById('user-info');
        
        if (authButtons) {
            authButtons.classList.remove('hidden');
            authButtons.style.display = '';
        }
        if (userInfo) {
            userInfo.classList.add('hidden');
            userInfo.style.display = 'none';
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
        return this.currentUser ? (this.currentUser.displayName || this.currentUser.email.split('@')[0]) : null;
    }
}

// Initialize global SuperSteaks system
let superSteaksGlobal = null;

// Initialize when Firebase is ready
document.addEventListener('DOMContentLoaded', () => {
    if (window.firebaseReady) {
        superSteaksGlobal = new SuperSteaksGlobal();
        window.superSteaksGlobal = superSteaksGlobal;
    } else {
        // Wait for Firebase to be ready
        const checkFirebase = setInterval(() => {
            if (window.firebaseReady) {
                superSteaksGlobal = new SuperSteaksGlobal();
                window.superSteaksGlobal = superSteaksGlobal;
                clearInterval(checkFirebase);
            }
        }, 100);
    }
});