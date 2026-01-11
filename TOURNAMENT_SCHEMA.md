# Tournament Platform Schema

## Firestore Collections

### 1. tournaments/{tournamentId}
Tournament metadata and configuration.

```javascript
{
  id: "champ-league-2026",
  name: "Champions League 2026",
  description: "European football champions",
  status: "active", // active, draft, completed, archived
  teamCount: 16,
  maxLobbiesActive: null, // unlimited if null
  teams: [
    { name: "Ajax", color: "#D2122E" },
    { name: "Arsenal", color: "#EF0107" },
    // ... 14 more teams
  ],
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### 2. lobbies/{tournamentId}_{lobbyId}
Individual lobby state for a tournament.

```javascript
{
  id: "champ-league-2026_lobby_1",
  tournamentId: "champ-league-2026",
  lobbyId: "lobby_1",
  capacity: 16,
  currentCount: 12,
  userIds: ["user1", "user2", ..., "user12"],
  status: "open", // open, full, closed
  teams: {
    "user1": "Ajax",
    "user2": "Arsenal",
    // ... team assignments in this lobby
  },
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### 3. teamAssignments/{assignmentId}
User team assignments across lobbies and tournaments.

```javascript
{
  id: "assign_abc123",
  userId: "user1",
  tournamentId: "champ-league-2026",
  lobbyId: "lobby_1",
  team: "Ajax",
  assignedAt: timestamp,
  status: "active" // active, replaced, forfeited
}
```

## Key Relationships
- Tournament → many Lobbies (1 lobby fills with N users, then new lobby created)
- Lobby → N TeamAssignments (one per user in that lobby)
- User → many TeamAssignments (user can be in multiple tournaments)

## Uniqueness Constraints
- **Per Lobby**: Each user has exactly 1 team assignment in that lobby
- **Per User/Tournament**: User can have only 1 active assignment per tournament
- **Per Team/Lobby**: Each team assigned to max 1 user per lobby

## Indexing Needed
- `teamAssignments`: (userId, tournamentId, status) for user's active tournaments
- `lobbies`: (tournamentId, status) for finding open/full lobbies
