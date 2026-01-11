# Tournament System Deployment Guide

## Prerequisites
- Node.js 14+ installed
- Firebase CLI installed: `npm install -g firebase-tools`
- Authenticated to Firebase: `firebase login`

## Current Status

### ✅ Completed Components
1. **Cloud Function** (`functions/index.js`): `joinTournament()` function implemented with Firestore transactions
2. **Firestore Rules** (`firestore.rules`): Updated to support tournaments, lobbies, and teamAssignments
3. **Frontend Pages**:
   - `tournaments.html`: Lists available tournaments
   - `lobby.html`: Shows lobby details and players
   - Updated `supersteaks-global.js` with `joinTournament()` method

### 📋 Deployment Steps

#### 1. Deploy Cloud Function and Firestore Rules
```bash
cd /path/to/supersteaks
firebase deploy --only functions,firestore:rules
```

Expected output:
```
✔ Deploy complete!
✔ functions[joinTournament] deployed
✔ firestore rules deployed
```

#### 2. Create Sample Tournaments (Via Firebase Console)

Use the Firebase Console to create tournaments in the `tournaments` collection:

**Tournament 1 - 16-Team Tournament**
```json
{
  "name": "Premier League Cup",
  "description": "Battle with the world's best clubs",
  "teamCount": 16,
  "status": "active",
  "createdAt": 1702000000000,
  "createdBy": "admin",
  "rules": "Win your lobby to advance to playoffs"
}
```

**Tournament 2 - 32-Team Tournament**
```json
{
  "name": "UEFA Champions League",
  "description": "Elite 32-team tournament format",
  "teamCount": 32,
  "status": "active",
  "createdAt": 1702000000000,
  "createdBy": "admin",
  "rules": "First come, first served lobby placement"
}
```

**Tournament 3 - 8-Team Quick Tournament**
```json
{
  "name": "Quick Fire Cup",
  "description": "Fast-paced 8-team tournament",
  "teamCount": 8,
  "status": "active",
  "createdAt": 1702000000000,
  "createdBy": "admin",
  "rules": "Winner takes all!"
}
```

### 🔄 How the Tournament System Works

1. **User joins tournament** via `tournaments.html`
2. **`joinTournament()` Cloud Function**:
   - Validates tournament exists
   - Checks user not already registered
   - Finds open lobby or creates new one
   - Atomically assigns random available team
   - Returns assignment + lobby details
3. **User redirected to lobby view** (`lobby.html`)
4. **Real-time updates** show other players joining same lobby

### 🔐 Security Model

- **Firestore Rules**:
  - All authenticated users can read `tournaments` and `lobbies`
  - Only Cloud Function (via service account) can write to `teamAssignments`
  - Prevents client-side data manipulation
  
- **Cloud Function**:
  - Validates user authentication
  - Uses Firestore transactions for atomicity
  - Ensures no race conditions during concurrent joins

### 📊 Firestore Collections

#### `tournaments` Collection
```
tournaments/{tournamentId}
├── name: string
├── description: string
├── teamCount: number (e.g., 16, 32)
├── status: 'active' | 'full' | 'closed'
├── createdAt: timestamp
├── createdBy: string
└── rules: string
```

#### `lobbies` Collection
```
lobbies/{lobbyId} (format: {tournamentId}_lobby_{number})
├── tournamentId: string
├── status: 'open' | 'full'
├── currentCount: number (users assigned)
├── teams: map (teamName -> userId)
└── createdAt: timestamp
```

#### `teamAssignments` Collection
```
teamAssignments/{assignmentId}
├── userId: string
├── username: string
├── email: string
├── tournamentId: string
├── lobbyId: string
├── team: string (team name)
├── assignedAt: timestamp
└── [legacy] contest: string (for backward compatibility)
```

### 🧪 Testing the System

1. **Manual Testing**:
   - Create tournament with 4 teams
   - Sign in as User A, join tournament
   - Sign in as User B (different browser/incognito), join same tournament
   - Verify User B gets different team
   - Refresh lobby view, see both players

2. **Concurrent Load Testing**:
   - Open tournament link in multiple tabs
   - Click "Join" rapidly across tabs
   - All users should get unique teams (preventing race conditions)

### 🐛 Troubleshooting

**"Authentication system not available" Error**
- Ensure `supersteaks-global.js` is properly loaded
- Check browser console for JavaScript errors
- Verify Firebase SDK is initialized

**"Cloud Function not found" Error**
- Verify Cloud Function was deployed: `firebase deploy --only functions`
- Check Cloud Functions dashboard in Firebase Console

**"No teams available" Error**
- Tournament may be full (all teams assigned)
- Create new tournament or wait for existing one to clear

**"Already registered" Error**
- User already has assignment in this tournament
- User must use different tournament

### 📱 Frontend Integration

The system is already integrated into:
- `tournaments.html`: Landing page showing all tournaments
- `lobby.html`: Lobby dashboard with real-time player updates
- `supersteaks-global.js`: `joinTournament(tournamentId)` method

### 🚀 Next Steps

1. Run `firebase deploy --only functions,firestore:rules`
2. Create sample tournaments in Firebase Console
3. Test end-to-end flow
4. Monitor Cloud Function logs: `firebase functions:log`
5. Gather user feedback and iterate

### 📞 Support

For deployment issues:
1. Check `firebase.json` configuration
2. Verify service account permissions
3. Review Cloud Function logs in Firebase Console
4. Check Firestore security rules syntax

