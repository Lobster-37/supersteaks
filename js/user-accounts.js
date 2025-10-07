// SuperSteaks User Account Management System
// Uses localStorage for simple user management (no backend required)

class UserAccountSystem {
    constructor() {
        this.currentUser = null;
        this.users = this.loadUsers();
        this.initializeEventListeners();
        this.checkExistingSession();
    }

    // Load users from localStorage
    loadUsers() {
        const usersData = localStorage.getItem('supersteaks_users');
        return usersData ? JSON.parse(usersData) : {};
    }

    // Save users to localStorage
    saveUsers() {
        localStorage.setItem('supersteaks_users', JSON.stringify(this.users));
    }

    // Save current session
