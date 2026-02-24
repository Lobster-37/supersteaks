// Fixtures & Results Page JavaScript

let currentLeague = 'premier-league';
let currentView = 'table';
const FIXTURES_LEAGUE_STORAGE_KEY = 'fixtures:selectedLeague';
const FIXTURES_VIEW_STORAGE_KEY = 'fixtures:selectedView';

// Initialize page when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeFixturesPage();
});

function initializeFixturesPage() {
    setupProfileDropdownHandlers();
    restoreSavedState();
    // Set up tab listeners
    setupLeagueTabs();
    setupViewTabs();
    setActiveLeagueTab(currentLeague);
    setActiveViewTab(currentView);
    showView(currentView);
    
    // Load initial data
    loadLeagueData();
    
    // Set up real-time listener for data updates
    setupDataListener();
}

function setupProfileDropdownHandlers() {
    const mobileProfileBtn = document.getElementById('mobile-profile-btn');
    const profileDropdownBtn = document.getElementById('profile-dropdown-btn');
    const profileDropdown = document.getElementById('profile-dropdown');
    const logoutBtn = document.getElementById('logout-btn-dropdown');

    const toggleDropdown = (event) => {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (profileDropdown) {
            profileDropdown.classList.toggle('hidden');
        }
    };

    if (mobileProfileBtn) {
        mobileProfileBtn.addEventListener('click', toggleDropdown);
    }

    if (profileDropdownBtn) {
        profileDropdownBtn.addEventListener('click', toggleDropdown);
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            try {
                await firebase.auth().signOut();
            } catch (error) {
                console.error('Logout failed:', error);
            }
        });
    }
}

function setupLeagueTabs() {
    const leagueTabs = document.querySelectorAll('.league-tab');
    leagueTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            currentLeague = tab.dataset.league;
            setActiveLeagueTab(currentLeague);
            localStorage.setItem(FIXTURES_LEAGUE_STORAGE_KEY, currentLeague);
            loadLeagueData();
        });
    });
}

function setupViewTabs() {
    const viewTabs = document.querySelectorAll('.view-tab');
    viewTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            currentView = tab.dataset.view;
            setActiveViewTab(currentView);
            localStorage.setItem(FIXTURES_VIEW_STORAGE_KEY, currentView);
            showView(currentView);
        });
    });
}

function restoreSavedState() {
    const savedLeague = localStorage.getItem(FIXTURES_LEAGUE_STORAGE_KEY);
    const savedView = localStorage.getItem(FIXTURES_VIEW_STORAGE_KEY);

    const validLeague = !!document.querySelector(`.league-tab[data-league="${savedLeague}"]`);
    const validView = !!document.querySelector(`.view-tab[data-view="${savedView}"]`);

    if (savedLeague && validLeague) {
        currentLeague = savedLeague;
    }

    if (savedView && validView) {
        currentView = savedView;
    }
}

function setActiveLeagueTab(league) {
    const leagueTabs = document.querySelectorAll('.league-tab');
    leagueTabs.forEach(tab => {
        const isActive = tab.dataset.league === league;
        tab.classList.remove('league-tab-active', 'bg-red-600', 'text-white');
        tab.classList.add('bg-gray-200', 'hover:bg-gray-300');

        if (isActive) {
            tab.classList.remove('bg-gray-200', 'hover:bg-gray-300');
            tab.classList.add('league-tab-active');
        }
    });
}

function setActiveViewTab(view) {
    const viewTabs = document.querySelectorAll('.view-tab');
    viewTabs.forEach(tab => {
        if (tab.dataset.view === view) {
            tab.classList.add('tab-active');
        } else {
            tab.classList.remove('tab-active');
        }
    });
}

function showView(view) {
    const views = ['fixtures-view', 'results-view', 'table-view'];
    views.forEach(v => {
        const element = document.getElementById(v);
        if (v === `${view}-view`) {
            element.classList.remove('hidden');
        } else {
            element.classList.add('hidden');
        }
    });
}

async function loadLeagueData() {
    const loadingState = document.getElementById('loading-state');
    const contentContainer = document.getElementById('content-container');
    
    loadingState.classList.remove('hidden');
    contentContainer.classList.add('hidden');
    
    try {
        // Load all data for the league
        await Promise.all([
            loadFixtures(),
            loadResults(),
            loadTable()
        ]);
        
        loadingState.classList.add('hidden');
        contentContainer.classList.remove('hidden');
        
        // Update last updated timestamp
        updateLastUpdatedTime();
    } catch (error) {
        console.error('Error loading league data:', error);
        loadingState.innerHTML = `
            <div class="text-center py-12">
                <p class="text-red-600 mb-4">Error loading data. Please try again later.</p>
                <button onclick="loadLeagueData()" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                    Retry
                </button>
            </div>
        `;
    }
}

async function loadFixtures() {
    const fixturesList = document.getElementById('fixtures-list');
    
    try {
        const snapshot = await firebase.firestore()
            .collection('leagues')
            .doc(currentLeague)
            .collection('fixtures')
            .orderBy('timestamp', 'asc')
            .limit(200)
            .get();
        
        if (snapshot.empty) {
            fixturesList.innerHTML = `
                <div class="text-center py-12 text-gray-500">
                    <p>No upcoming fixtures available.</p>
                    <p class="text-sm mt-2">Data will be updated automatically every 2 minutes.</p>
                </div>
            `;
            return;
        }
        
        let html = '';
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        snapshot.forEach(doc => {
            const fixture = doc.data();
            // Hide past-dated no-score fixtures (postponed/cancelled matches)
            const fixtureDate = new Date(fixture.date);
            if (fixtureDate < today) {
                return; // Skip this fixture
            }
            const date = formatDate(fixture.date);
            const time = fixture.time || 'TBD';
            
            html += `
                <div class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition">
                    <div class="flex justify-between items-center">
                        <div class="flex-1">
                            <div class="font-semibold">${fixture.homeTeam}</div>
                            <div class="text-sm text-gray-600 mt-1">vs</div>
                            <div class="font-semibold">${fixture.awayTeam}</div>
                        </div>
                        <div class="text-right text-sm text-gray-600">
                            <div>${date}</div>
                            <div class="mt-1">${time}</div>
                            ${fixture.venue ? `<div class="text-xs mt-1">${fixture.venue}</div>` : ''}
                        </div>
                    </div>
                </div>
            `;
        });
        
        fixturesList.innerHTML = html;
    } catch (error) {
        console.error('Error loading fixtures:', error);
        fixturesList.innerHTML = '<div class="text-center py-12 text-red-600">Error loading fixtures</div>';
    }
}

async function loadResults() {
    const resultsList = document.getElementById('results-list');
    
    try {
        const snapshot = await firebase.firestore()
            .collection('leagues')
            .doc(currentLeague)
            .collection('results')
            .orderBy('timestamp', 'desc')
            .limit(200)
            .get();
        
        if (snapshot.empty) {
            resultsList.innerHTML = `
                <div class="text-center py-12 text-gray-500">
                    <p>No recent results available.</p>
                    <p class="text-sm mt-2">Data will be updated automatically every 2 minutes.</p>
                </div>
            `;
            return;
        }
        
        let html = '';
        snapshot.forEach(doc => {
            const result = doc.data();
            if (result.homeScore === null || result.homeScore === undefined || result.awayScore === null || result.awayScore === undefined) {
                return;
            }
            const date = formatDate(result.date);
            
            html += `
                <div class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition">
                    <div class="flex justify-between items-center">
                        <div class="flex-1">
                            <div class="flex items-center justify-between">
                                <span class="font-semibold">${result.homeTeam}</span>
                                <span class="text-2xl font-bold text-gray-800 mx-4">${result.homeScore}</span>
                            </div>
                            <div class="flex items-center justify-between mt-2">
                                <span class="font-semibold">${result.awayTeam}</span>
                                <span class="text-2xl font-bold text-gray-800 mx-4">${result.awayScore}</span>
                            </div>
                        </div>
                        <div class="text-right text-sm text-gray-600 ml-4">
                            <div>${date}</div>
                            ${result.venue ? `<div class="text-xs mt-1">${result.venue}</div>` : ''}
                        </div>
                    </div>
                </div>
            `;
        });
        
        resultsList.innerHTML = html;
    } catch (error) {
        console.error('Error loading results:', error);
        resultsList.innerHTML = '<div class="text-center py-12 text-red-600">Error loading results</div>';
    }
}

async function loadTable() {
    const tableBody = document.getElementById('table-body');
    
    try {
        const snapshot = await firebase.firestore()
            .collection('leagues')
            .doc(currentLeague)
            .collection('standings')
            .orderBy('position', 'asc')
            .get();
        
        if (snapshot.empty) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="10" class="text-center py-12 text-gray-500">
                        <p>No standings available.</p>
                        <p class="text-sm mt-2">Data will be updated automatically every 10 minutes.</p>
                    </td>
                </tr>
            `;
            return;
        }
        
        let html = '';
        snapshot.forEach(doc => {
            const team = doc.data();
            const gdClass = team.goalDifference > 0 ? 'text-green-600' : team.goalDifference < 0 ? 'text-red-600' : '';
            
            html += `
                <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3 text-center font-semibold">${team.position}</td>
                    <td class="px-4 py-3">${team.teamName}</td>
                    <td class="px-4 py-3 text-center">${team.played}</td>
                    <td class="px-4 py-3 text-center">${team.won}</td>
                    <td class="px-4 py-3 text-center">${team.drawn}</td>
                    <td class="px-4 py-3 text-center">${team.lost}</td>
                    <td class="px-4 py-3 text-center">${team.goalsFor}</td>
                    <td class="px-4 py-3 text-center">${team.goalsAgainst}</td>
                    <td class="px-4 py-3 text-center ${gdClass}">${team.goalDifference > 0 ? '+' : ''}${team.goalDifference}</td>
                    <td class="px-4 py-3 text-center font-bold">${team.points}</td>
                </tr>
            `;
        });
        
        tableBody.innerHTML = html;
    } catch (error) {
        console.error('Error loading table:', error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" class="text-center py-12 text-red-600">Error loading table</td>
            </tr>
        `;
    }
}

function setupDataListener() {
    // Listen for updates to the current league
    firebase.firestore()
        .collection('leagues')
        .doc(currentLeague)
        .onSnapshot(() => {
            console.log('League data updated, refreshing...');
            loadLeagueData();
        });
}

async function updateLastUpdatedTime() {
    try {
        const doc = await firebase.firestore()
            .collection('leagues')
            .doc(currentLeague)
            .get();
        
        if (doc.exists && doc.data().lastUpdated) {
            const timestamp = doc.data().lastUpdated.toDate();
            const timeString = timestamp.toLocaleString('en-GB', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            document.getElementById('last-updated').textContent = `Last updated: ${timeString}`;
        }
    } catch (error) {
        console.error('Error getting last updated time:', error);
    }
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}
