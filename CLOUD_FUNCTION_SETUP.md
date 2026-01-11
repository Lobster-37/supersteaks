# Cloud Function Setup for SuperSteaks

## What's Changed

I've set up a secure server-side Cloud Function to handle all team assignments. This prevents users from:
- Querying the `teamAssignments` collection directly
- Submitting their own team assignments
- Modifying assignments after they're made

All randomization happens **server-side** in the Cloud Function, which is much more secure.

## Files Created/Modified

### New Files:
- `functions/index.js` - Cloud Function that handles `enterDraw()` 
- `functions/package.json` - Dependencies for the function
- `.firebaserc` - Firebase project configuration

### Modified Files:
- `firestore.rules` - Updated to block all user writes (only Cloud Functions can write)
- `js/supersteaks-global.js` - Updated to call Cloud Function instead of direct Firestore writes
- All HTML files - Added Firebase Functions SDK script tag

## Deployment Steps

### 1. Update Firebase Project ID in `.firebaserc`

Edit `.firebaserc` and replace `your-firebase-project-id` with your actual Firebase project ID:

```json
{
  "projects": {
    "default": "YOUR-PROJECT-ID"
  }
}
```

### 2. Deploy the Cloud Function

You'll need Node.js and Firebase CLI installed:

```bash
# Install Node.js from https://nodejs.org/ (LTS version)

# Then in the supersteaks directory:
npm install -g firebase-tools
firebase login
firebase deploy --only functions
```

This will deploy the `enterDraw` Cloud Function.

### 3. Deploy Updated Firestore Rules

```bash
firebase deploy --only firestore:rules
```

Or deploy both at once:
```bash
firebase deploy --only firestore:rules,functions
```

### 4. Test It

Once deployed:
1. Go to your games.html page
2. Log in with your test account
3. Click "Enter Draw Now"
4. The app will now call the secure Cloud Function
5. You should get a random team assigned

## How It Works

**Before (Insecure):**
- Client reads all assignments
- Client picks a random team
- Client writes to Firestore
- ❌ A malicious user could query the collection or modify data

**After (Secure):**
- User clicks "Enter Draw Now"
- App calls `enterDraw()` Cloud Function
- Cloud Function:
  - Verifies user is authenticated
  - Checks if user already has assignment
  - Queries all assignments (users can't do this)
  - Randomly selects a team (server-side randomization)
  - Writes to Firestore
  - Returns result to client
- ❌ Users can't query, modify, or access the collection

## Security Rules

The new rules block all direct user access to `teamAssignments`:

```javascript
match /teamAssignments/{document=**} {
  allow read: if request.auth != null && resource.data.userId == request.auth.uid;
  allow write: if false;  // Only Cloud Functions can write
}
```

Users can only read their **own** assignments (where userId matches their auth UID).
