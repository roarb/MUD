// ============================================================
// DUNGEON CRAWLER MUD — Client App
// WebSocket client + DOM manipulation
// ============================================================

(function () {
    'use strict';

    // --- DOM References ---
    const outputArea = document.getElementById('output-area');
    const outputContent = document.getElementById('output-content');
    const nameEntry = document.getElementById('name-entry');
    const nameInput = document.getElementById('name-input');
    const nameSubmit = document.getElementById('name-submit');
    const inputArea = document.getElementById('input-area');
    const gameInput = document.getElementById('game-input');
    const promptChar = document.getElementById('prompt-char');
    const connectionStatus = document.getElementById('connection-status');
    const playerHud = document.getElementById('player-hud');
    const hpBar = document.getElementById('hp-bar');
    const hpValue = document.getElementById('hp-value');
    const levelValue = document.getElementById('level-value');
    const xpValue = document.getElementById('xp-value');
    const locationValue = document.getElementById('location-value');
    const processingIndicator = document.getElementById('processing-indicator');
    const achievementToast = document.getElementById('achievement-toast');
    const achievementTitle = document.getElementById('achievement-title');
    const achievementDesc = document.getElementById('achievement-desc');
    const achievementTier = document.getElementById('achievement-tier');

    // --- State ---
    let ws = null;
    let playerId = null;
    let commandHistory = [];
    let historyIndex = -1;
    let achievementTimeout = null;

    // --- WebSocket Connection ---
    function connect() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${location.host}/ws`;

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            connectionStatus.textContent = '● CONNECTED';
            connectionStatus.classList.add('connected');
            appendSystemMessage('Connection established. The System acknowledges your presence.');
        };

        ws.onclose = () => {
            connectionStatus.textContent = '● DISCONNECTED';
            connectionStatus.classList.remove('connected');
            appendSystemMessage('Connection lost. Attempting to reconnect...');
            setTimeout(connect, 3000);
        };

        ws.onerror = (err) => {
            console.error('[WS] Error:', err);
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            handleServerMessage(msg);
        };
    }

    // --- Server Message Handler ---
    function handleServerMessage(msg) {
        switch (msg.type) {
            case 'player_created':
                playerId = msg.playerId;
                localStorage.setItem('playerId', playerId);
                nameEntry.style.display = 'none';
                inputArea.style.display = 'block';
                playerHud.style.display = 'flex';
                appendSystemMessage(`Crawler "${msg.playerName}" registered. ID: ${msg.playerId.slice(0, 8)}...`);
                gameInput.focus();
                break;

            case 'player_loaded':
                playerId = msg.playerId;
                nameEntry.style.display = 'none';
                inputArea.style.display = 'block';
                playerHud.style.display = 'flex';
                appendSystemMessage(`Welcome back, ${msg.playerName}.`);
                gameInput.focus();
                break;

            case 'game_output':
                appendGameOutput(msg.text);
                if (msg.player) updateHud(msg.player);
                if (msg.achievement) showAchievement(msg.achievement);
                break;

            case 'processing':
                processingIndicator.style.display = msg.active ? 'flex' : 'none';
                if (msg.active) {
                    gameInput.disabled = true;
                    promptChar.style.opacity = '0.3';
                } else {
                    gameInput.disabled = false;
                    promptChar.style.opacity = '1';
                    gameInput.focus();
                }
                break;

            case 'error':
                appendErrorMessage(msg.message);
                break;
        }
    }

    // --- Output Functions ---
    function appendGameOutput(text) {
        const div = document.createElement('div');
        div.className = 'game-msg';
        div.textContent = text;
        outputContent.appendChild(div);
        scrollToBottom();
    }

    function appendUserInput(text) {
        const div = document.createElement('div');
        div.className = 'game-msg game-msg--user';
        div.textContent = `> ${text}`;
        outputContent.appendChild(div);
        scrollToBottom();
    }

    function appendSystemMessage(text) {
        const div = document.createElement('div');
        div.className = 'game-msg game-msg--system';
        div.textContent = `[System] ${text}`;
        outputContent.appendChild(div);
        scrollToBottom();
    }

    function appendErrorMessage(text) {
        const div = document.createElement('div');
        div.className = 'game-msg game-msg--error';
        div.textContent = `❌ ${text}`;
        outputContent.appendChild(div);
        scrollToBottom();
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            outputArea.scrollTop = outputArea.scrollHeight;
        });
    }

    // --- HUD Update ---
    function updateHud(player) {
        if (!player) return;

        const hpPercent = Math.max(0, (player.hp / player.maxHp) * 100);
        hpBar.style.width = `${hpPercent}%`;
        hpValue.textContent = `${player.hp}/${player.maxHp}`;

        // Critical HP effect
        if (hpPercent <= 25) {
            hpBar.classList.add('critical');
        } else {
            hpBar.classList.remove('critical');
        }

        levelValue.textContent = player.level;
        xpValue.textContent = player.xp;
        locationValue.textContent = formatLocation(player.location);

        // Dead state
        if (!player.alive) {
            hpBar.style.width = '0%';
            hpBar.classList.add('critical');
            appendSystemMessage('You have died. Refresh to start a new game.');
            gameInput.disabled = true;
        }
    }

    function formatLocation(loc) {
        if (!loc) return '--';
        return loc.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    // --- Achievement Toast ---
    function showAchievement(achievement) {
        if (!achievement) return;

        achievementTitle.textContent = achievement.title;
        achievementDesc.textContent = `"${achievement.description}"`;
        achievementTier.textContent = `Reward: ${achievement.tier.charAt(0).toUpperCase() + achievement.tier.slice(1)} Loot Box`;

        // Set tier class
        achievementToast.className = `achievement-toast tier-${achievement.tier}`;
        achievementTier.className = `achievement-toast__tier ${achievement.tier}`;

        achievementToast.style.display = 'flex';
        achievementToast.style.animation = 'toast-slide-in 0.4s ease forwards';

        // Clear previous timeout
        if (achievementTimeout) clearTimeout(achievementTimeout);

        // Auto-dismiss after 6 seconds
        achievementTimeout = setTimeout(() => {
            achievementToast.style.animation = 'toast-slide-out 0.4s ease forwards';
            setTimeout(() => {
                achievementToast.style.display = 'none';
            }, 400);
        }, 6000);
    }

    // --- Input Handling ---
    function sendGameInput(text) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            appendErrorMessage('Not connected to server.');
            return;
        }

        if (!text.trim()) return;

        // Add to history
        commandHistory.push(text);
        if (commandHistory.length > 50) commandHistory.shift();
        historyIndex = commandHistory.length;

        appendUserInput(text);

        ws.send(JSON.stringify({
            type: 'game_input',
            text: text,
        }));
    }

    function submitName(name) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            appendErrorMessage('Not connected to server.');
            return;
        }

        if (!name.trim()) {
            name = 'Unnamed Crawler';
        }

        ws.send(JSON.stringify({
            type: 'create_player',
            name: name.trim(),
        }));
    }

    // --- Event Listeners ---
    // Name entry
    nameSubmit.addEventListener('click', () => {
        submitName(nameInput.value);
    });

    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            submitName(nameInput.value);
        }
    });

    // Game input
    gameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const text = gameInput.value.trim();
            if (text) {
                sendGameInput(text);
                gameInput.value = '';
            }
        }

        // Command history
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (historyIndex > 0) {
                historyIndex--;
                gameInput.value = commandHistory[historyIndex];
            }
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex < commandHistory.length - 1) {
                historyIndex++;
                gameInput.value = commandHistory[historyIndex];
            } else {
                historyIndex = commandHistory.length;
                gameInput.value = '';
            }
        }
    });

    // --- Check for existing player ---
    function checkExistingPlayer() {
        const savedId = localStorage.getItem('playerId');
        if (savedId && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'load_player',
                playerId: savedId,
            }));
            return true;
        }
        return false;
    }

    // --- Initialize ---
    connect();

    // Focus name input on load
    nameInput.focus();
})();
