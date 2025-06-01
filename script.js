
const teams = ["Team A", "Team B", "Team C", "Team D", "Team E"];

function assignTeam() {
    const randomIndex = Math.floor(Math.random() * teams.length);
    const team = teams[randomIndex];
    document.getElementById("teamDisplay").innerText = "You've been assigned: " + team;
}
