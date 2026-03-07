const { initializeApp } = require("firebase/app");
const { getDatabase, ref, update, get, child, set, runTransaction, push } = require("firebase/database");
const express = require('express');

// server.js - New Project Migration
const firebaseConfig = {
  apiKey: "AIzaSyCMoALpMpplt-vz4dkhaMzh315wwOhPZh4",
  authDomain: "spin-cards-86e6f.firebaseapp.com",
  databaseURL: "https://spin-cards-86e6f-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "spin-cards-86e6f",
  storageBucket: "spin-cards-86e6f.firebasestorage.app",
  messagingSenderId: "305473056071",
  appId: "1:305473056071:web:5b278492b216edc5fdb062"
};

// --- INITIALIZE FIREBASE & DB ---
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const CARD_MAP = [
    { id: 1, rank: 'J', suit: '♠' }, { id: 2, rank: 'J', suit: '♥' }, { id: 3, rank: 'J', suit: '♣' }, { id: 4, rank: 'J', suit: '♦' },
    { id: 5, rank: 'Q', suit: '♠' }, { id: 6, rank: 'Q', suit: '♥' }, { id: 7, rank: 'Q', suit: '♣' }, { id: 8, rank: 'Q', suit: '♦' },
    { id: 9, rank: 'K', suit: '♠' }, { id: 10, rank: 'K', suit: '♥' }, { id: 11, rank: 'K', suit: '♣' }, { id: 12, rank: 'K', suit: '♦' }
];

// --- 2. GAME SETTINGS ---
const CYCLE_TIME = 180; // 3 Minutes
let timer = CYCLE_TIME;
let status = "BETTING"; 
let dailySpinCount = 0;

console.log("✅ ROYAL VEGAS SERVER - CENTRALIZED SYNC STARTED");
console.log("-----------------------------------------------");

// --- 3. MAIN SERVER LOOP (Runs every 1 second) ---
setInterval(async () => {
    // A. Daily Reset Check (Modified for Midnight Reset)
    await checkDailyReset();

    // B. Betting Phase
    if (status === "BETTING") {
        timer--;
        
        // Broadcast time to all clients (PC & Mobile)
        update(ref(db, 'game_state'), {
            time_left: timer,
            status: "BETTING"
        }).catch(e => console.error("Sync Error:", e));

        // C. Trigger Spin
       if (timer <= 0 && status === "BETTING") {
    await runSpinSequence();
}
    }
}, 1000); // <-- 1 Second Timer for Game Loop

// --- 7. AUTOMATIC 48-HOUR PASSBOOK CLEANUP ---
// Runs every 1 hour (3600000 ms) in the background
setInterval(async () => {
    try {
        console.log("🧹 Running 48-Hour Passbook Cleanup...");
        const usersSnap = await get(ref(db, 'users'));
        if (!usersSnap.exists()) return;

        const users = usersSnap.val();
        const cutoffTime = Date.now() - (48 * 60 * 60 * 1000); // Exact time 48 hours ago

        // Loop through all users in the database
        for (const uid of Object.keys(users)) {
            const txnsRef = ref(db, `users/${uid}/transactions`);
            const txnsSnap = await get(txnsRef);
            
            if (txnsSnap.exists()) {
                let deletedCount = 0;
                
                txnsSnap.forEach(childSnap => {
                    const txn = childSnap.val();
                    
                    // Look for our exact timestamp, otherwise try to read the string date
                    let txnTime = txn.timestamp || Date.parse(txn.date);

                    // If the transaction is older than 48 hours, delete it!
                    if (txnTime && txnTime < cutoffTime) {
                        set(ref(db, `users/${uid}/transactions/${childSnap.key}`), null);
                        deletedCount++;
                    }
                });
                
                if (deletedCount > 0) {
                    console.log(`🗑️ Deleted ${deletedCount} old passbook entries for User: ${uid}`);
                }
            }
        }
    } catch (e) {
        console.error("Cleanup Error:", e);
    }
}, 60 * 60 * 1000); // <-- 1 Hour Timer for Passbook Cleanup



// --- 4. SPIN LOGIC ---
async function runSpinSequence() {
    status = "SPINNING";
    console.log("\n\n🎰 STARTING SPIN SEQUENCE...");

    // A. DETERMINE RESULT (Auto Bias + Admin Rigging)
    let finalResult = Math.floor(Math.random() * 12) + 1; // Default Random
    let finalMulti = 1;

    try {
        // 1. Check if Admin manually rigged the wheel (Admin Panel Override)
        let adminOverride = false;
        const houseControlSnap = await get(child(ref(db), 'house_control'));
        
        if (houseControlSnap.exists()) {
            const data = houseControlSnap.val();
            if (data.number && data.number > 0) {
                finalResult = parseInt(data.number);
                adminOverride = true;
                console.log(`⚠️ ADMIN OVERRIDE APPLIED: ${CARD_MAP[finalResult - 1].rank}${CARD_MAP[finalResult - 1].suit}`);
            }
            if (data.multiplier && data.multiplier >= 1) {
                finalMulti = parseInt(data.multiplier);
            }
        }

        // 2. AUTO SMART BIAS (Protect the House automatically!)
        if (!adminOverride) {
            const betsSnap = await get(child(ref(db), 'current_round_bets'));
            if (betsSnap.exists()) {
                const allPlayers = betsSnap.val();
                let liability = {1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0, 10:0, 11:0, 12:0};

               // Calculate TOTAL LIABILITY (Payout amount) for each number
                for (const playerBets of Object.values(allPlayers)) {
                    for (const [num, amt] of Object.entries(playerBets)) {
                        // Liability is the amount they bet * 10 * the multiplier
                        liability[num] += (parseInt(amt) || 0) * 10 * finalMulti; 
                    }
                }

                // Find the absolute lowest payout amount
                let minLiability = Infinity;
                for (let i = 1; i <= 12; i++) {
                    if (liability[i] < minLiability) {
                        minLiability = liability[i];
                    }
                }

                // Find all numbers that have this minimum liability
                let bestHouseNumbers = [];
                for (let i = 1; i <= 12; i++) {
                    if (liability[i] === minLiability) {
                        bestHouseNumbers.push(i);
                    }
                }

                // Pick a random number from the safe list
                finalResult = bestHouseNumbers[Math.floor(Math.random() * bestHouseNumbers.length)];
                console.log(`🧠 AUTO BIAS APPLIED: House picked ${CARD_MAP[finalResult - 1].rank}${CARD_MAP[finalResult - 1].suit} (Min Liability: ₹${minLiability})`);
            }
        }
    } catch (e) { console.error("Error with Rigging/Bias:", e); }

   // B. BROADCAST RESULT TO CLIENTS (STARTS ANIMATION INSTANTLY)
    
    dailySpinCount++; // 🚨 Increment the spin count!

    // Save it to the database so it survives server restarts
    update(ref(db, 'house_stats'), { 
        daily_spin_count: dailySpinCount 
    });

    update(ref(db, 'game_state'), {
        status: "SPINNING",
        result: finalResult,
        multiplier: finalMulti,
        time_left: 0,
        spin_count: dailySpinCount // 🟢 Broadcast to clients
    });

    console.log("⏳ Wheel Spinning... Waiting 8 seconds before updating history/volume...");

    // ==============================================================
    // C. DELAYED LOGIC (Wait for 8s Animation to Finish)
    // ==============================================================
    setTimeout(async () => {
        
        // 1. SAVE HISTORY (QUEUE) - Happens when wheel stops
        // 1. SAVE HISTORY (QUEUE) - Happens when wheel stops
        // 1. SAVE HISTORY (QUEUE) - Happens when wheel stops
        console.log("📝 Updating History Queue...");
        const historyRef = ref(db, 'results_history');
        const newEntryRef = push(historyRef); 
        
        // ✅ CORRECT HISTORY UPDATE
        await set(newEntryRef, {
            result: finalResult,
            multiplier: finalMulti, 
            timestamp: Date.now()
        });
        // 2. CLEANUP HISTORY (Keep last 20)
        const snap = await get(historyRef);
        if (snap.exists() && snap.size > 20) { 
            // FIX: Convert to array and sort by TIMESTAMP (Time) instead of ID
            const historyList = [];
            snap.forEach(childSnap => {
                historyList.push({ key: childSnap.key, ...childSnap.val() });
            });

            // Sort: Oldest time first
            historyList.sort((a, b) => a.timestamp - b.timestamp);

            // Calculate how many to remove
            let toRemove = historyList.length - 20;

            // Remove the oldest ones
            for(let i=0; i<toRemove; i++) {
                console.log(`🗑️ Deleting old history: ${historyList[i].key}`);
                set(ref(db, `results_history/${historyList[i].key}`), null);
            }
        }

        // 2. CALCULATE PAYOUTS & UPDATE USER WALLETS DIRECTLY FROM SERVER
        const betsSnap = await get(child(ref(db), 'current_round_bets'));
        let totalPayout = 0;

        if (betsSnap.exists()) {
            const allPlayers = betsSnap.val();
            
            // Loop through every player who placed a bet
            for (const [uid, playerBets] of Object.entries(allPlayers)) {
                if (playerBets[finalResult]) {
                    const winAmount = playerBets[finalResult] * 10 * finalMulti;
                    totalPayout += winAmount;

                    // A. Add winning amount to Player's Balance
                    const userBalRef = ref(db, `users/${uid}/balance`);
                    const txnResult = await runTransaction(userBalRef, (currentBal) => {
                        return (parseFloat(currentBal) || 0) + winAmount;
                    });

                   // B. Log the transaction in the Player's Passbook
                    if (txnResult.committed) {
                        const newBal = txnResult.snapshot.val();
                        const passbookRef = push(ref(db, `users/${uid}/transactions`));
                        
                        await set(passbookRef, {
                            amount: winAmount,
                            balance: newBal,
                            description: `Won on ${CARD_MAP[finalResult - 1].rank}${CARD_MAP[finalResult - 1].suit} (${finalMulti}x)`,
                            date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                            billNo: "SYS-PAYOUT",
                            spin_count: dailySpinCount, 
                            timestamp: Date.now()
                        });
                        
                        console.log(`✅ Paid ₹${winAmount} to User: ${uid}`);
                    }
                } // End of if (playerBets[finalResult])
            } // End of for (const [uid...
        } // End of if (betsSnap.exists())

        // UPDATE FIREBASE: SUBTRACT PAYOUTS FROM HOUSE VOLUME
        if (totalPayout > 0) {
            console.log(`📊 TOTAL PAYOUTS: -${totalPayout} (Subtracted from Global Volume)`);
            const volRef = ref(db, 'house_stats/daily_volume');
            
            await runTransaction(volRef, (currentVol) => {
                return (currentVol || 0) - totalPayout;
            });
        } else {
            console.log("💤 No payouts this round.");
        }

        // 3. CLEANUP & RESET 
        set(ref(db, 'current_round_bets'), {});
       update(ref(db, 'house_stats'), { daily_spin_count: dailySpinCount })

        resetGame();

    }, 8000); // <--- 8 SECOND DELAY FOR ANIMATION
}

function resetGame() {
    status = "BETTING";
    timer = CYCLE_TIME;
    console.log("🔄 NEW ROUND STARTED");
}

// --- 5. DAILY VOLUME RESET (MIDNIGHT LOGIC) ---
let localLastResetDate = null; // Store in server memory to prevent 86,400 DB reads/day

async function checkDailyReset() {
    // 1. Get Current Date in INDIA TIME (IST)
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata', // Forces 12AM India Time
        year: 'numeric', month: 'numeric', day: 'numeric'
    });
    const todayStr = formatter.format(now);

    // 2. Fetch from Firebase ONLY ONCE when server first starts
    if (localLastResetDate === null) {
        const volRef = child(ref(db), 'house_stats');
        const snapshot = await get(volRef);
        const stats = snapshot.val() || {};
        
        // ✅ Load everything into memory here
        localLastResetDate = stats.last_reset_date || todayStr; 
        dailySpinCount = stats.daily_spin_count || 0; 
        return; 
    }

    // 3. ZERO-COST CHECK: Compare memory date vs today's date
    if (todayStr !== localLastResetDate) {
        console.log(`📅 NEW DAY DETECTED (${todayStr}) - RESETTING DAILY VOLUME & HISTORY`);
        
        dailySpinCount = 0; // Reset spin count in memory

        await update(ref(db, 'house_stats'), { 
            daily_volume: 0, 
            daily_spin_count: 0, // Reset spin count in database
            last_reset_date: todayStr 
        });

        await set(ref(db, 'results_history'), null);
        localLastResetDate = todayStr;
    } 
}

    

/// --- 6. RENDER DEPLOYMENT SERVER ---
const appServer = express();
const port = process.env.PORT || 10000;
const path = require('path');

// 1. Point exactly to your frontend folder!
// The ".." tells the server to step back one folder, then open SPINCARDSFRONTEND
const frontendPath = path.join(__dirname, 'SpinCardsFrontend');

// 2. Tell Express to serve files from this new path
appServer.use(express.static(frontendPath));

// 3. Update the routes to pull from frontendPath instead of __dirname
appServer.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

appServer.get('/index.html', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

appServer.get('/admin.html', (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin.html'));
});

appServer.get('/ids.html', (req, res) => {
    res.sendFile(path.join(frontendPath, 'ids.html'));
});

appServer.get('/funds.html', (req, res) => {
    res.sendFile(path.join(frontendPath, 'funds.html'));
});

appServer.get('/passbook.html', (req, res) => {
    res.sendFile(path.join(frontendPath, 'passbook.html'));
});

appServer.get('/login.html', (req, res) => {
    res.sendFile(path.join(frontendPath, 'login.html'));
});
// --- START THE SERVER ---
appServer.listen(port, () => {
    console.log(`🚀 HTTP Server listening on port ${port}`);
    console.log(`🌐 Game URL: http://localhost:${port}`);
    console.log(`📊 IDs URL:  http://localhost:${port}/ids.html`);
    console.log(`⚙️  Admin URL: http://localhost:${port}/admin.html`);
});