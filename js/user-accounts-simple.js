// SuperSteaks User Account Management System
// Simple localStorage-based version (no cloud database required)

class UserAccountSystem {
    constructor() {
        this.users = {};
        this.currentUser = null;
        this.loadUsers();
        this.checkCurrentUser();
    }

    loadUsers() {
        const saved = localStorage.getItem('champLeagueUsers');
        if (saved) {
            this.users = JSON.parse(saved);
        }
    }

    saveUsers() {
        localStorage.setItem('champLeagueUsers', JSON.stringify(this.users));
    }

    checkCurrentUser() {
        const currentUsername = localStorage.getItem('currentUser');
        if (currentUsername && this.users[currentUsername]) {
            this.currentUser = this.users[currentUsername];
            this.updateUIForLoggedInState();
        }
    }

    register(username, email, password) {
        // Validate input
        if (!username || !email || !password) {
            throw new Error('All fields are required');
        }

        // Check if username already exists
        if (this.users[username]) {
            throw new Error('Username already exists');
        }

        // Create new user
        const newUser = {
            username: username,
            email: email,
            password: password, // In production, this should be hashed
            registeredAt: new Date().toISOString(),
            teams: []
        };

        this.users[username] = newUser;
        this.saveUsers();
        
        return newUser;
    }

    login(username, password) {
        const user = this.users[username];
        
        if (!user) {
            throw new Error('User not found');
        }
        
        if (user.password !== password) {
            throw new Error('Invalid password');
        }
        
        this.currentUser = user;
        localStorage.setItem('currentUser', username);
        this.updateUIForLoggedInState();
        
        return user;
    }

    logout() {
        this.currentUser = null;
        localStorage.removeItem('currentUser');
        this.updateUIForLoggedOutState();
    }

    getCurrentUser() {
        return this.currentUser;
    }

    addTeamAssignment(teamName, contestName) {
        if (!this.currentUser) {
            throw new Error('No user logged in');
        }

        // Check if team is already assigned to someone else
        for (const [username, user] of Object.entries(this.users)) {
            if (username !== this.currentUser.username) {
                const hasTeam = user.teams.some(team => 
                    team.teamName === teamName && team.contestName === contestName
                );
                if (hasTeam) {
                    throw new Error(`Team ${teamName} is already assigned to ${username}`);
                }
            }
        }

        // Check if current user already has a team for this contest
        const existingTeam = this.currentUser.teams.find(team => team.contestName === contestName);
        if (existingTeam) {
            throw new Error(`You already have ${existingTeam.teamName} for ${contestName}`);
        }

        // Add team assignment
        const teamAssignment = {
            teamName: teamName,
            contestName: contestName,
            assignedAt: new Date().toISOString()
        };

        this.currentUser.teams.push(teamAssignment);
        this.users[this.currentUser.username] = this.currentUser;
        this.saveUsers();

        return teamAssignment;
    }

    getAvailableTeams(contestName, allTeams) {
        const assignedTeams = new Set();
        
        // Collect all assigned teams for this contest
        for (const user of Object.values(this.users)) {
            user.teams.forEach(team => {
                if (team.contestName === contestName) {
                    assignedTeams.add(team.teamName);
                }
            });
        }

        // Return teams that aren't assigned
        return allTeams.filter(team => !assignedTeams.has(team));
    }

    getAllUsers() {
        return this.users;
    }

    getTeamAssignments(contestName) {
        const assignments = {};
        
        for (const [username, user] of Object.entries(this.users)) {
            const team = user.teams.find(t => t.contestName === contestName);
            if (team) {
                assignments[username] = team.teamName;
            }
        }
        
        return assignments;
    }

    updateUIForLoggedInState() {
        const authButtons = document.getElementById('auth-buttons');
        const userInfo = document.getElementById('user-info');
        const usernameDisplay = document.getElementById('username-display');
        
        if (authButtons) authButtons.classList.add('hidden');
        if (userInfo) userInfo.classList.remove('hidden');
        if (usernameDisplay) usernameDisplay.textContent = this.currentUser.username;
    }

    updateUIForLoggedOutState() {
        const authButtons = document.getElementById('auth-buttons');
        const userInfo = document.getElementById('user-info');
        
        if (authButtons) authButtons.classList.remove('hidden');
        if (userInfo) userInfo.classList.add('hidden');
    }

    // Initialize event listeners for auth forms
    initializeEventListeners() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupEventListeners());
        } else {
            this.setupEventListeners();
        }
    }

    setupEventListeners() {
        // Login form
        const loginForm = document.getElementById('login-form-element');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLogin();
            });
        }

        // Register form
        const registerForm = document.getElementById('register-form-element');
        if (registerForm) {
            registerForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleRegister();
            });
        }

        // Logout button
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.logout();
                // Redirect to home page after logout
                window.location.href = 'index.html';
            });
        }
    }

    handleLogin() {
        const username = document.getElementById('login-username')?.value;
        const password = document.getElementById('login-password')?.value;

        try {
            this.login(username, password);
            this.hideAuthModal();
            this.showSuccessMessage(`Welcome back, ${username}!`);
            
            // Refresh the page to update UI
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } catch (error) {
            this.showErrorMessage(error.message);
        }
    }

    handleRegister() {
        const username = document.getElementById('register-username')?.value;
        const email = document.getElementById('register-email')?.value;
        const password = document.getElementById('register-password')?.value;

        try {
            this.register(username, email, password);
            this.login(username, password); // Auto-login after registration
            this.hideAuthModal();
            this.showSuccessMessage(`Account created successfully! Welcome, ${username}!`);
            
            // Refresh the page to update UI
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } catch (error) {
            this.showErrorMessage(error.message);
        }
    }

    showSuccessMessage(message) {
        // Create a simple success message
        const alertDiv = document.createElement('div');
        alertDiv.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
        alertDiv.textContent = message;
        document.body.appendChild(alertDiv);
        
        // Remove after 3 seconds
        setTimeout(() => {
            alertDiv.remove();
        }, 3000);
    }

    showErrorMessage(message) {
        // Create a simple error message
        const alertDiv = document.createElement('div');
        alertDiv.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
        alertDiv.textContent = message;
        document.body.appendChild(alertDiv);
        
        // Remove after 3 seconds
        setTimeout(() => {
            alertDiv.remove();
        }, 3000);
    }

    hideAuthModal() {
        const modal = document.getElementById('auth-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }
}

// Initialize the system when the script loads
const userAccountSystem = new UserAccountSystem();

// Make it globally available
window.userAccountSystem = userAccountSystem;