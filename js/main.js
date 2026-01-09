/**
 * Night Train - Narrative Roguelike Engine
 * Pure vanilla JavaScript, no dependencies
 */

(function () {
    'use strict';

    // ============================================
    // Constants & Configuration
    // ============================================
    const STORAGE_KEY = 'nighttrain_save';
    const SCENES_URL = 'scenes.json';
    const ASSET_PATHS = {
        train: 'assets/images/',
        npc: 'assets/images/'
    };

    // Default world state
    const DEFAULT_STATE = {
        loop: 1,
        train_stability: 80,
        reality_noise: 0,
        inspector_trust: 30,
        anomaly_awareness: 0,
        flags: {},
        playedScenes: [],
        currentSceneId: 'start',
        sceneCount: 0,
        turnCount: 0,  // Dialogue turn counter for loop limit
        dialogHistory: [],
        bgmVolume: 0.5,
        isBgmMuted: false
    };

    // Ending definitions
    const ENDINGS = {
        train_anomaly: {
            title: '列车异变',
            description: '车厢开始扭曲，走廊无限延伸。你意识到这列车本身就是一个异常——而你已深陷其中。',
            condition: (state) => state.train_stability <= 25
        },
        detained: {
            title: '身份拘束',
            description: '检票员对你露出了满意的微笑。"很好，您的配合让一切变得简单。请跟我来。" 你感到四肢逐渐失去控制。',
            condition: (state) => state.inspector_trust >= 75 && state.reality_noise < 60
        },
        awakening: {
            title: '异常觉醒',
            description: '你看穿了这列车的真相。循环、乘客、目的地——一切都不过是某种意识实验的表象。你选择打破这个牢笼。',
            condition: (state) => state.reality_noise >= 90 || state.anomaly_awareness >= 90
        },
        normal_arrival: {
            title: '普通到站',
            description: '列车缓缓停靠。你下车，站在陌生的站台上。身后的列车门关闭，你知道自己很快会再次登车。',
            condition: (state) => state.sceneCount >= 50
        },
        turn_limit: {
            title: '列车到站',
            description: '列车减速了。你感到一阵眩晕。\n\n...如果再来一次，你会问不一样的问题吗？',
            condition: (state) => state.turnCount >= 15
        }
    };

    // Thoughts data - hints shown in UI, changes based on worldState
    // These provide subtle guidance to players about what to do
    const THOUGHTS = [
        // Starting hints (loop 1, early game)
        { id: 'goal1', text: '也许该找找车票...', condition: (s) => s.loop === 1 && !s.flags.has_note && s.sceneCount < 3 },
        { id: 'explore', text: '试着在车厢里走动看看', condition: (s) => s.sceneCount < 2 },
        { id: 'talk', text: '可以直接输入想说的话', condition: (s) => s.turnCount < 3 },

        // Location-aware hints
        { id: 'inspector_hint', text: '检票员在等你出示车票', condition: (s) => s.currentSceneId === 'inspector_area' && !s.flags.met_inspector },
        { id: 'anomaly_hint', text: '那个乘客...似乎不太正常', condition: (s) => s.currentSceneId === 'anomaly_area' && !s.flags.approached_anomaly },
        { id: 'silent_hint', text: '沉默乘客手里好像有东西', condition: (s) => s.currentSceneId === 'silent_area' && !s.flags.saw_note },

        // Progress-based hints
        { id: 'note_hint', text: '那张纸条上写了什么...', condition: (s) => s.flags.saw_note && !s.flags.has_note },
        { id: 'truth_hint', text: '也许该问问其他人知道什么', condition: (s) => s.flags.has_note },

        // Danger warnings
        { id: 'stability_warn', text: '列车在颤抖...发生了什么？', condition: (s) => s.train_stability < 50 },
        { id: 'noise_warn', text: '周围的一切开始变得模糊...', condition: (s) => s.reality_noise > 60 },

        // Loop 2+ meta-hints
        { id: 'loop_memory', text: '这一切...似曾相识', condition: (s) => s.loop >= 2 },
        { id: 'loop_differ', text: '这次也许该试试别的做法', condition: (s) => s.loop >= 2 && s.sceneCount < 3 },
        { id: 'destination', text: '这列车...真的会到站吗？', condition: (s) => true },
    ];

    // ============================================
    // Game State
    // ============================================
    let worldState = null;
    let scenes = [];
    let isTransitioning = false;
    let isStreaming = false;
    let currentAbortController = null;  // For cancelling ongoing requests
    let lastRequestTime = 0;  // Cooldown tracking
    const REQUEST_COOLDOWN_MS = 1500;  // Minimum gap between requests

    // DOM Elements cache
    const DOM = {};

    // ============================================
    // Initialization
    // ============================================
    async function init() {
        cacheDOMElements();
        bindEvents();
        await loadScenes();
        loadOrCreateState();
        initAudio();
        renderState();
        renderThoughts();
        showScene(worldState.currentSceneId);
        checkTutorial();
    }

    function cacheDOMElements() {
        DOM.statLoop = document.getElementById('stat-loop');
        DOM.statStability = document.getElementById('stat-stability');
        DOM.statNoise = document.getElementById('stat-noise');
        DOM.statTrust = document.getElementById('stat-trust');
        DOM.statAwareness = document.getElementById('stat-awareness');
        DOM.backgroundLayer = document.getElementById('background-layer');
        DOM.npcLayer = document.getElementById('npc-layer');
        DOM.sceneTitle = document.getElementById('scene-title');
        DOM.sceneNpc = document.getElementById('scene-npc');
        DOM.sceneText = document.getElementById('scene-text');
        DOM.choicesContainer = document.getElementById('choices-container');
        DOM.endingOverlay = document.getElementById('ending-overlay');
        DOM.endingTitle = document.getElementById('ending-title');
        DOM.endingDescription = document.getElementById('ending-description');
        DOM.endingStats = document.getElementById('ending-stats');
        DOM.btnNextLoop = document.getElementById('btn-next-loop');
        DOM.btnNewGame = document.getElementById('btn-new-game');
        DOM.btnClearSave = document.getElementById('btn-clear-save');
        DOM.chatInput = document.getElementById('chat-input');
        DOM.btnSendChat = document.getElementById('btn-send-chat');

        // New UI Elements
        DOM.historyOverlay = document.getElementById('history-overlay');
        DOM.historyContent = document.getElementById('history-content');
        DOM.btnCloseHistory = document.getElementById('btn-close-history');
        DOM.btnHistory = document.getElementById('btn-history');
        DOM.bgm = document.getElementById('bgm');
        DOM.btnBgm = document.getElementById('btn-bgm');
        DOM.btnBgmMobile = document.getElementById('btn-bgm-mobile');

        // Tutorial Elements
        DOM.tutorialOverlay = document.getElementById('tutorial-overlay');
        DOM.btnTutorialStart = document.getElementById('btn-tutorial-start');
        DOM.btnHelp = document.getElementById('btn-help');
        DOM.thoughtsList = document.getElementById('thoughts-list');
        DOM.turnCounter = document.getElementById('turn-counter');

        // Scene Navigation
        DOM.btnNavPrev = document.getElementById('btn-nav-prev');
        DOM.btnNavNext = document.getElementById('btn-nav-next');
    }

    function bindEvents() {
        DOM.btnNewGame.addEventListener('click', startNewGame);
        DOM.btnClearSave.addEventListener('click', clearSaveWithConfirm);
        DOM.btnNextLoop.addEventListener('click', startNextLoop);

        // Chat Events
        DOM.btnSendChat.addEventListener('click', handleChatSubmit);
        DOM.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleChatSubmit();
        });

        // History Events
        DOM.btnHistory.addEventListener('click', () => toggleHistory(true));
        DOM.btnCloseHistory.addEventListener('click', () => toggleHistory(false));

        // BGM Events
        DOM.btnBgm.addEventListener('click', toggleBgm);
        if (DOM.btnBgmMobile) {
            DOM.btnBgmMobile.addEventListener('click', toggleBgm);
        }

        // Auto-play BGM interaction check
        document.body.addEventListener('click', ensureBgmPlaying, { once: true });

        // Tutorial Events
        if (DOM.btnTutorialStart) {
            DOM.btnTutorialStart.addEventListener('click', () => toggleTutorial(false));
        }

        // Help Button
        if (DOM.btnHelp) {
            DOM.btnHelp.addEventListener('click', () => toggleTutorial(true));
        }

        // Prevent accidental reset when clicking input
        if (DOM.chatInput) {
            DOM.chatInput.addEventListener('mousedown', (e) => e.stopPropagation());
            DOM.chatInput.addEventListener('click', (e) => e.stopPropagation());
        }

        // Scene Navigation Buttons
        if (DOM.btnNavPrev) {
            DOM.btnNavPrev.addEventListener('click', () => navigateScene('prev'));
        }
        if (DOM.btnNavNext) {
            DOM.btnNavNext.addEventListener('click', () => navigateScene('next'));
        }
    }

    async function loadScenes() {
        try {
            const response = await fetch(SCENES_URL);
            if (!response.ok) throw new Error('Failed to load scenes');
            scenes = await response.json();
            console.log(`Loaded ${scenes.length} scenes`);
        } catch (error) {
            console.error('Error loading scenes:', error);
            scenes = getFallbackScenes();
        }
    }

    // ============================================
    // Audio System
    // ============================================
    // ============================================
    // Audio System
    // ============================================
    const AUDIO_TRACKS = {
        ambient: 'assets/audio/bgm_ambient.mp3',
        suspense: 'assets/audio/bgm_suspense.mp3'
    };

    let currentTrack = null;

    function initAudio() {
        if (worldState.isBgmMuted) {
            DOM.bgm.muted = true;
            DOM.btnBgm.textContent = '🔇 BGM';
            if (DOM.btnBgmMobile) DOM.btnBgmMobile.textContent = '🔇';
        } else {
            DOM.bgm.muted = false;
            DOM.btnBgm.textContent = '🔊 BGM';
            if (DOM.btnBgmMobile) DOM.btnBgmMobile.textContent = '🔊';
        }
        DOM.bgm.volume = worldState.bgmVolume || 0.5;
        updateBgmTrack();
    }

    let audioFadeInterval = null;

    function updateBgmTrack() {
        // Determine which track to play based on state
        const targetTrack = (worldState.reality_noise > 40 || worldState.train_stability < 40)
            ? 'suspense'
            : 'ambient';

        if (currentTrack !== targetTrack) {
            fadeOutAndSwitch(targetTrack);
        }
    }

    function fadeOutAndSwitch(trackKey) {
        const nextSrc = AUDIO_TRACKS[trackKey];
        if (!nextSrc) return;

        currentTrack = trackKey;

        // If nothing is playing, just start
        if (!DOM.bgm.src || DOM.bgm.paused) {
            DOM.bgm.src = nextSrc;
            if (!worldState.isBgmMuted) {
                DOM.bgm.play().catch(e => console.log("First play blocked"));
            }
            return;
        }

        // Cross-fade (simple version)
        if (audioFadeInterval) clearInterval(audioFadeInterval);
        let vol = DOM.bgm.volume;
        audioFadeInterval = setInterval(() => {
            vol -= 0.05;
            if (vol <= 0) {
                clearInterval(audioFadeInterval);
                audioFadeInterval = null;
                DOM.bgm.src = nextSrc;
                DOM.bgm.load();
                DOM.bgm.play().then(() => {
                    fadeIn();
                }).catch(e => console.log(e));
            } else {
                DOM.bgm.volume = Math.max(0, vol);
            }
        }, 50);
    }

    function fadeIn() {
        if (audioFadeInterval) clearInterval(audioFadeInterval);
        let vol = 0;
        const targetVol = worldState.bgmVolume || 0.5;
        audioFadeInterval = setInterval(() => {
            vol += 0.05;
            if (vol >= targetVol) {
                clearInterval(audioFadeInterval);
                audioFadeInterval = null;
                DOM.bgm.volume = targetVol;
            } else {
                DOM.bgm.volume = Math.min(targetVol, vol);
            }
        }, 50);
    }

    function ensureBgmPlaying() {
        if (!DOM.bgm.paused || worldState.isBgmMuted) return;
        DOM.bgm.play().catch(e => console.log("Audio autoplay prevented"));
    }

    function toggleBgm() {
        worldState.isBgmMuted = !worldState.isBgmMuted;
        DOM.bgm.muted = worldState.isBgmMuted;

        if (worldState.isBgmMuted) {
            DOM.btnBgm.textContent = '🔇 BGM';
            if (DOM.btnBgmMobile) DOM.btnBgmMobile.textContent = '🔇';
            DOM.bgm.pause();
        } else {
            DOM.btnBgm.textContent = '🔊 BGM';
            if (DOM.btnBgmMobile) DOM.btnBgmMobile.textContent = '🔊';
            if (!DOM.bgm.src) updateBgmTrack();
            DOM.bgm.play().catch(e => console.error(e));
        }
        saveState();
    }

    // ============================================
    // Tutorial System
    // ============================================
    function checkTutorial() {
        const tutorialSeen = localStorage.getItem('nighttrain_tutorial_seen');
        if (!tutorialSeen) {
            toggleTutorial(true);
        }
    }

    function toggleTutorial(show) {
        if (show) {
            DOM.tutorialOverlay.classList.add('active');
        } else {
            DOM.tutorialOverlay.classList.remove('active');
            localStorage.setItem('nighttrain_tutorial_seen', 'true');
            ensureBgmPlaying();
        }
    }

    // ============================================
    // History System
    // ============================================
    function addToHistory(role, text, sceneTitle, npcName) {
        if (!text) return;
        const entry = {
            role,
            text,
            sceneTitle: sceneTitle || '未知场景',
            npcName: npcName || '',
            timestamp: Date.now()
        };

        if (!worldState.dialogHistory) worldState.dialogHistory = [];
        worldState.dialogHistory.push(entry);

        // Limit history size to prevent save bloat
        if (worldState.dialogHistory.length > 50) {
            worldState.dialogHistory.shift();
        }
        saveState();
    }

    function toggleHistory(show) {
        if (show) {
            renderHistory();
            DOM.historyOverlay.classList.add('active');
        } else {
            DOM.historyOverlay.classList.remove('active');
        }
    }

    function renderHistory() {
        DOM.historyContent.innerHTML = '';
        if (!worldState.dialogHistory || worldState.dialogHistory.length === 0) {
            DOM.historyContent.innerHTML = '<div class="history-item">暂无记录</div>';
            return;
        }

        worldState.dialogHistory.slice().reverse().forEach(entry => {
            const div = document.createElement('div');
            div.className = 'history-item';

            const title = document.createElement('span');
            title.className = 'history-scene-title';
            title.textContent = entry.sceneTitle;

            const content = document.createElement('div');
            content.className = 'history-text';

            if (entry.role === 'npc' && entry.npcName) {
                const nameSpan = document.createElement('span');
                nameSpan.className = 'history-npc-name';
                nameSpan.textContent = `[${entry.npcName}]`;
                content.appendChild(nameSpan);
            } else if (entry.role === 'user') {
                const nameSpan = document.createElement('span');
                nameSpan.className = 'history-npc-name';
                nameSpan.style.color = 'var(--accent-cyan)';
                nameSpan.textContent = `[你]`;
                content.appendChild(nameSpan);
            }

            content.appendChild(document.createTextNode(entry.text));

            div.appendChild(title);
            div.appendChild(content);
            DOM.historyContent.appendChild(div);
        });
    }

    // ============================================
    // State Management
    // ============================================
    function loadOrCreateState() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                worldState = JSON.parse(saved);
                worldState = { ...DEFAULT_STATE, ...worldState };
                console.log('Loaded saved state, loop:', worldState.loop);
            } catch (e) {
                console.warn('Failed to parse save, creating new state');
                worldState = { ...DEFAULT_STATE };
            }
        } else {
            worldState = { ...DEFAULT_STATE };
        }
    }

    function saveState() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(worldState));
    }

    function startNewGame() {
        worldState = { ...DEFAULT_STATE };
        worldState.flags = {};
        worldState.playedScenes = [];
        worldState.dialogHistory = [];

        // Reset Location History
        currentLocationIndex = 0;
        LOCATIONS.forEach(loc => loc.savedHTML = null);

        saveState();
        hideEnding();
        renderState();
        renderThoughts();
        showScene('start');
    }

    function clearSaveWithConfirm() {
        if (confirm('确定要清空所有存档吗？这将删除所有进度和跨局记忆。')) {
            localStorage.removeItem(STORAGE_KEY);
            startNewGame();
        }
    }

    function startNextLoop() {
        worldState.loop += 1;
        worldState.train_stability = randomInt(75, 85);
        worldState.reality_noise = Math.min(100, worldState.reality_noise + 5);
        worldState.inspector_trust = randomInt(20, 40);
        worldState.anomaly_awareness = Math.min(100, Math.floor(worldState.anomaly_awareness * 0.5) + 10);
        worldState.playedScenes = [];
        worldState.currentSceneId = 'start';
        worldState.sceneCount = 0;
        worldState.turnCount = 0;  // Reset turn count for new loop

        // Reset Location History
        currentLocationIndex = 0;
        LOCATIONS.forEach(loc => loc.savedHTML = null);

        saveState();
        hideEnding();
        renderState();
        renderThoughts();  // Update thoughts for new loop
        showScene('start');
    }

    // ============================================
    // Scene System
    // ============================================
    function showScene(sceneId) {
        if (isTransitioning) return;

        const scene = scenes.find(s => s.id === sceneId);
        if (!scene) {
            const nextScene = selectNextScene();
            if (nextScene) showScene(nextScene.id);
            else triggerEnding('normal_arrival');
            return;
        }

        isTransitioning = true;
        worldState.currentSceneId = sceneId;

        if (!worldState.playedScenes.includes(sceneId)) {
            worldState.playedScenes.push(sceneId);
        }

        DOM.sceneText.classList.add('fade-out');
        DOM.choicesContainer.classList.add('fade-out');

        setTimeout(() => {
            updateBackground(scene.background);
            updateNPC(scene.npc, scene.npcSprite);

            const processedText = processText(scene.text);

            // Record initial scene text to history
            // We only add it if it's not a reload of the same scene without transition (simple check)
            addToHistory('desc', processedText, scene.title);

            DOM.sceneTitle.textContent = scene.title || '未知场景';
            DOM.sceneNpc.textContent = getNpcLabel(scene.npc);
            typewriter(DOM.sceneText, `<p>${processedText}</p>`);

            renderChoices(scene.choices);

            DOM.sceneText.classList.remove('fade-out');
            DOM.choicesContainer.classList.remove('fade-out');

            saveState();
            isTransitioning = false;
        }, 300);
    }

    // Fixed locations for navigation (can revisit, preserves dialogue)
    // Fixed locations for navigation (with separate dialogue history)
    const LOCATIONS = [
        { id: 'start', name: '车厢', bg: 'train_bg_2.png', npc: null, defaultSceneId: 'start', savedHTML: null },
        { id: 'inspector', name: '检票员', bg: 'train_bg_2.png', npc: 'inspector_1.png', npcType: 'inspector', defaultSceneId: 'inspector_01', savedHTML: null },
        { id: 'anomaly', name: '异常乘客', bg: 'train_bg_3.png', npc: 'anomaly_1.png', npcType: 'anomaly', defaultSceneId: 'anomaly_01', savedHTML: null },
        { id: 'silent', name: '沉默乘客', bg: 'train_bg_2.png', npc: 'silent_passenger.png', npcType: 'silent', defaultSceneId: 'silent_01', savedHTML: null },
        { id: 'corridor', name: '过道', bg: 'corridor_view.png', npc: null, defaultSceneId: 'corridor_01', savedHTML: null }
    ];
    let currentLocationIndex = 0;

    // Helper to find and sync current location based on worldState
    function syncLocationIndex() {
        const currentId = worldState.currentSceneId;
        // Find index of location that matches ID or is a prefix
        const index = LOCATIONS.findIndex(loc =>
            currentId === loc.id || currentId.startsWith(loc.id + '_') || (loc.defaultSceneId && currentId === loc.defaultSceneId)
        );
        if (index !== -1) {
            currentLocationIndex = index;
            return true;
        }
        return false;
    }

    // Random Events
    const RANDOM_EVENTS = ['event_glitch', 'event_whisper'];

    // Navigate between fixed locations (preserves dialogue)
    function navigateScene(direction) {
        if (isTransitioning || isStreaming) return;
        ensureBgmPlaying();

        // 1. Sync index and save current dialogue
        // This ensures if we jumped to a location via dialogue, we save to the CORRECT place
        if (!worldState.currentSceneId.startsWith('event_')) {
            syncLocationIndex(); // IMPORTANT: Update index based on actual current scene
            const currentLoc = LOCATIONS[currentLocationIndex];
            if (currentLoc) {
                currentLoc.savedHTML = DOM.sceneText.innerHTML;
            }
        }

        // 10% Chance for Random Event (skip if already in event)
        if (Math.random() < 0.1) {
            const eventId = RANDOM_EVENTS[randomInt(0, RANDOM_EVENTS.length - 1)];
            if (!worldState.currentSceneId.startsWith('event_')) {
                worldState.sceneCount++;
                advanceToNextScene(eventId, true);
                return;
            }
        }

        // Calculate new index
        if (direction === 'prev') {
            currentLocationIndex = (currentLocationIndex - 1 + LOCATIONS.length) % LOCATIONS.length;
        } else {
            currentLocationIndex = (currentLocationIndex + 1) % LOCATIONS.length;
        }

        const loc = LOCATIONS[currentLocationIndex];

        // Smooth transition - only change visuals, NOT dialogue
        isTransitioning = true;
        DOM.backgroundLayer.classList.add('fade-out');
        DOM.npcLayer.classList.add('fade-out');

        setTimeout(() => {
            // Update background
            DOM.backgroundLayer.innerHTML = `<img src="assets/images/${loc.bg}" alt="${loc.name}" onerror="this.parentElement.innerHTML='<div class=placeholder-bg>列车背景</div>'">`;

            // Update NPC sprite
            if (loc.npc) {
                DOM.npcLayer.innerHTML = `<img src="assets/images/${loc.npc}" alt="${loc.name}">`;
            } else {
                DOM.npcLayer.innerHTML = '';
            }

            // Update scene title (but keep dialogue)
            const npcLabel = loc.npcType ? getNpcLabel(loc.npcType) : '';
            DOM.sceneTitle.textContent = loc.name;
            DOM.sceneNpc.textContent = npcLabel;

            // Update worldState for AI context
            worldState.currentSceneId = loc.id;
            saveState();

            // RESTORE DIALOGUE
            if (loc.savedHTML) {
                // Restore saved history
                DOM.sceneText.innerHTML = loc.savedHTML;
                DOM.sceneText.scrollTop = DOM.sceneText.scrollHeight;

                // Restore default choices for this location so user isn't stuck
                const defaultScene = scenes.find(s => s.id === loc.defaultSceneId);
                if (defaultScene) {
                    renderChoices(defaultScene.choices);
                } else {
                    renderChoices([]);
                }
            } else {
                // First visit: Load default scene text
                const defaultScene = scenes.find(s => s.id === loc.defaultSceneId);
                if (defaultScene) {
                    const text = processText(defaultScene.text);
                    typewriter(DOM.sceneText, `<p>${text}</p>`);
                    renderChoices(defaultScene.choices);
                } else {
                    DOM.sceneText.innerHTML = '<p>...</p>';
                    renderChoices([]);
                }
            }

            DOM.backgroundLayer.classList.remove('fade-out');
            DOM.npcLayer.classList.remove('fade-out');
            isTransitioning = false;
        }, 300);
    }

    function typewriter(element, htmlContent) {
        element.innerHTML = '';
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        const text = tempDiv.textContent;
        const p = document.createElement('p');
        element.appendChild(p);

        let i = 0;
        const speed = 20; // Faster typewriter

        function type() {
            if (i < text.length) {
                p.textContent += text.charAt(i);
                i++;
                setTimeout(type, speed);
                element.scrollTo({
                    top: element.scrollHeight,
                    behavior: 'smooth'
                });
            }
        }
        type();
    }

    // ... (Existing updateBackground, updateNPC, getNpcLabel, etc.) ...
    function updateBackground(bgName) {
        if (!bgName) {
            DOM.backgroundLayer.innerHTML = '<div class="placeholder-bg">列车背景</div>';
            return;
        }
        const imgPath = ASSET_PATHS.train + bgName;
        const img = new Image();
        img.onload = () => { DOM.backgroundLayer.innerHTML = ''; DOM.backgroundLayer.appendChild(img); };
        img.onerror = () => { DOM.backgroundLayer.innerHTML = `<div class="placeholder-bg">${bgName}</div>`; };
        img.src = imgPath;
    }

    function updateNPC(npcType, spriteName) {
        if (!npcType || npcType === 'none') {
            DOM.npcLayer.innerHTML = '';
            return;
        }
        if (!spriteName) {
            DOM.npcLayer.innerHTML = `<div class="npc-placeholder">[${getNpcLabel(npcType)}]</div>`;
            return;
        }
        const imgPath = ASSET_PATHS.npc + spriteName;
        const img = new Image();
        img.onload = () => { DOM.npcLayer.innerHTML = ''; DOM.npcLayer.appendChild(img); };
        img.onerror = () => { DOM.npcLayer.innerHTML = `<div class="npc-placeholder">[${spriteName}]</div>`; };
        img.src = imgPath;
    }

    function getNpcLabel(npcType) {
        const labels = { inspector: '检票员', anomaly: '异常乘客', silent: '沉默乘客', none: '' };
        return labels[npcType] !== undefined ? labels[npcType] : (npcType || '');
    }

    function processText(text) {
        if (!text) return '...';
        text = text.replace(/\{loop\}/g, worldState.loop);
        text = text.replace(/\{loop>=(\d+):([^}]+)\}/g, (match, num, content) => {
            return worldState.loop >= parseInt(num) ? content : '';
        });
        return text;
    }

    function renderChoices(choices) {
        DOM.choicesContainer.innerHTML = '';
        if (!choices || choices.length === 0) {
            const btn = document.createElement('button');
            btn.className = 'choice-btn';
            btn.textContent = '继续...';
            btn.addEventListener('click', () => advanceToNextScene(null));
            DOM.choicesContainer.appendChild(btn);
            return;
        }
        choices.forEach(choice => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn';
            btn.innerHTML = `<span>${choice.label}</span>`;
            btn.addEventListener('click', () => handleChoice(choice));
            DOM.choicesContainer.appendChild(btn);
        });
    }

    function handleChoice(choice) {
        if (isTransitioning || isStreaming) return;
        ensureBgmPlaying();

        // Determine choice type:
        // - dialogue: has quotes in label OR type === 'dialogue'
        // - event: type === 'event' (action description sent to AI)
        // - navigate: type === 'navigate' or 'action' WITH explicit next
        // - standard action: anything else (applies effects, may check endings)

        const hasQuotes = /["""“”]/.test(choice.label);
        const isDialogue = choice.type === 'dialogue' || (!choice.type && hasQuotes);
        const isEvent = choice.type === 'event';
        const isNavigate = choice.type === 'navigate';
        const isAction = choice.type === 'action';  // Always triggers scene transition

        // Dialogue and Event: Send to AI, no scene change
        if (isDialogue || isEvent) {
            if (choice.effects) applyEffects(choice.effects);
            if (choice.setFlags) Object.assign(worldState.flags, choice.setFlags);
            renderState();

            const chatText = isEvent ? `*你 ${choice.label}*` : choice.label;
            DOM.chatInput.value = chatText;
            handleChatSubmit();
            return;  // AI handles response, no scene switch
        }

        // Navigate or Action: Apply effects and switch scene
        if (isNavigate || isAction) {
            if (choice.effects) applyEffects(choice.effects);
            if (choice.setFlags) Object.assign(worldState.flags, choice.setFlags);
            worldState.sceneCount++;
            renderState();

            if (choice.ending) { triggerEnding(choice.ending); return; }
            advanceToNextScene(choice.next, true);
            return;
        }

        // Standard Action (no type, no quotes): Apply effects, then either advance or send to AI
        if (choice.effects) applyEffects(choice.effects);
        if (choice.setFlags) Object.assign(worldState.flags, choice.setFlags);
        renderState();

        // Check explicit ending
        if (choice.ending) { triggerEnding(choice.ending); return; }
        const ending = checkEndings();
        if (ending) { triggerEnding(ending); return; }

        // If 'next' is specified, advance to that scene
        if (choice.next) {
            worldState.sceneCount++;
            advanceToNextScene(choice.next, true);
            return;
        }

        // NO 'next' specified: send action to AI for narrative response
        // This makes buttons like '递上车票' trigger AI storytelling
        DOM.chatInput.value = `*你 ${choice.label}*`;
        handleChatSubmit();
    }

    function applyEffects(effects) {
        const prevStability = worldState.train_stability;
        const prevNoise = worldState.reality_noise;

        for (const [key, value] of Object.entries(effects)) {
            if (key in worldState && key !== 'flags' && key !== 'playedScenes') {
                worldState[key] = clamp(worldState[key] + value, 0, 100);
            }
        }

        if (prevStability - worldState.train_stability >= 10 || worldState.reality_noise - prevNoise >= 15) {
            triggerScreenShake();
        }

        // Check for BGM track switch
        updateBgmTrack();
    }

    function triggerScreenShake() {
        const container = document.querySelector('.game-container');
        if (container) {
            container.classList.add('shake');
            setTimeout(() => container.classList.remove('shake'), 400);
        }
    }

    function advanceToNextScene(nextId, fromPredefinedChoice = false) {
        // For AI-generated responses with null, stay in current scene
        if (!fromPredefinedChoice && (!nextId || nextId === worldState.currentSceneId)) {
            console.log('Staying in current scene:', worldState.currentSceneId);
            const scene = scenes.find(s => s.id === worldState.currentSceneId);
            if (scene) renderChoices(scene.choices);
            return;
        }

        // For predefined choices with null, or explicit scene ID, proceed
        if (nextId) {
            showScene(nextId);
        } else {
            // Random selection for predefined choices
            const nextScene = selectNextScene();
            if (nextScene) showScene(nextScene.id);
            else triggerEnding('normal_arrival');
        }
    }

    function selectNextScene() {
        const available = scenes.filter(scene => {
            if (worldState.playedScenes.includes(scene.id)) return false;
            // ONLY pick scenes explicitly marked as random
            if (!scene.random) return false;
            if (scene.conditions) return checkConditions(scene.conditions);
            return true;
        });
        if (available.length === 0) return null;
        return available[randomInt(0, available.length - 1)];
    }

    function checkConditions(conditions) {
        for (const [key, requirement] of Object.entries(conditions)) {
            if (key === 'flags') {
                for (const [flagName, flagValue] of Object.entries(requirement)) {
                    if (worldState.flags[flagName] !== flagValue) return false;
                }
                continue;
            }
            const value = worldState[key];
            if (value === undefined) continue;
            if (typeof requirement === 'number') {
                if (value !== requirement) return false;
            } else if (typeof requirement === 'object') {
                if (requirement.min !== undefined && value < requirement.min) return false;
                if (requirement.max !== undefined && value > requirement.max) return false;
                if (requirement.gte !== undefined && value < requirement.gte) return false;
                if (requirement.lte !== undefined && value > requirement.lte) return false;
            }
        }
        return true;
    }

    function checkEndings() {
        const endingOrder = ['train_anomaly', 'detained', 'awakening', 'normal_arrival'];
        for (const endingId of endingOrder) {
            const ending = ENDINGS[endingId];
            if (ending.condition(worldState)) {
                if (endingId === 'normal_arrival' && worldState.sceneCount < 5) continue;
                return endingId;
            }
        }
        return null;
    }

    function triggerEnding(endingId) {
        const ending = ENDINGS[endingId];
        DOM.endingTitle.textContent = ending.title;
        DOM.endingDescription.textContent = ending.description;
        DOM.endingStats.innerHTML = `
            循环 #${worldState.loop} | 场景数: ${worldState.sceneCount} | 
            稳定度: ${worldState.train_stability} | 噪声: ${worldState.reality_noise}
        `;
        DOM.endingOverlay.classList.add('active');
        saveState();
    }

    function hideEnding() {
        DOM.endingOverlay.classList.remove('active');
    }

    function renderState() {
        DOM.statLoop.textContent = worldState.loop;
        DOM.statStability.textContent = worldState.train_stability;
        DOM.statNoise.textContent = worldState.reality_noise;
        DOM.statTrust.textContent = worldState.inspector_trust;
        DOM.statAwareness.textContent = worldState.anomaly_awareness;

        DOM.statStability.style.color = worldState.train_stability <= 30 ? '#c77' : '';
        DOM.statNoise.style.color = worldState.reality_noise >= 60 ? '#b8a' : '';

        // Update turn counter
        const turnsRemaining = Math.max(0, 15 - worldState.turnCount);
        if (DOM.turnCounter) {
            DOM.turnCounter.textContent = `💬 ${turnsRemaining}`;
            DOM.turnCounter.style.color = turnsRemaining <= 3 ? '#ff6b6b' :
                turnsRemaining <= 7 ? '#ffd93d' : '';
        }
    }

    // ============================================
    // Thoughts System (Hint UI)
    // ============================================
    function renderThoughts() {
        if (!DOM.thoughtsList) return;
        DOM.thoughtsList.innerHTML = '';

        // Get applicable thoughts, later entries override earlier ones with same id
        const thoughtsMap = new Map();
        const previousThoughts = new Map();

        // First pass: collect what was shown before (for animation)
        DOM.thoughtsList.querySelectorAll('li').forEach(li => {
            previousThoughts.set(li.dataset.id, li.textContent);
        });

        // Build current thoughts (later entries with same id override earlier)
        THOUGHTS.forEach(thought => {
            if (thought.condition(worldState)) {
                thoughtsMap.set(thought.id, thought.text);
            }
        });

        // Render thoughts
        thoughtsMap.forEach((text, id) => {
            const li = document.createElement('li');
            li.textContent = text;
            li.dataset.id = id;

            // Add animation if text changed from previous
            if (previousThoughts.has(id) && previousThoughts.get(id) !== text) {
                li.classList.add('thought-updated');
            }

            DOM.thoughtsList.appendChild(li);
        });
    }

    function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
    function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
    function getFallbackScenes() { /* ... kept simple ... */ return [{ id: 'start', title: 'Fallback', npc: 'none', text: 'Error loading scenes', choices: [] }]; }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    // ============================================
    // Chat & Streaming System
    // ============================================
    async function handleChatSubmit() {
        const text = DOM.chatInput.value.trim();
        if (!text) return;

        // Cooldown check - prevent rapid requests
        const now = Date.now();
        if (now - lastRequestTime < REQUEST_COOLDOWN_MS) {
            console.log('Request cooldown active, please wait...');
            return;
        }

        // Cancel any ongoing request
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
        }

        // Block if still streaming (shouldn't happen due to abort, but safety check)
        if (isStreaming) return;

        lastRequestTime = now;

        // UI Updates
        DOM.chatInput.value = '';
        DOM.chatInput.disabled = true;
        DOM.btnSendChat.disabled = true;
        ensureBgmPlaying();

        const currentScene = scenes.find(s => s.id === worldState.currentSceneId);

        // Log History
        addToHistory('user', text, currentScene?.title);
        appendMessage('user', text);

        // Increment turn count
        worldState.turnCount++;
        saveState();
        renderState();  // Update turn countdown UI immediately

        // Check for turn limit ending (first loop soft failure)
        if (worldState.turnCount >= 15) {
            isStreaming = false;
            triggerEnding('turn_limit');
            DOM.chatInput.disabled = false;
            DOM.btnSendChat.disabled = false;
            return;
        }

        isStreaming = true;
        currentAbortController = new AbortController();
        const prompt = constructPrompt(text);

        try {
            await streamLLM(prompt, currentAbortController.signal);
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Request cancelled');
            } else {
                console.error('LLM Error:', error);
                appendMessage('system', '意识连接断开... (请稍后重试)');
            }
        } finally {
            DOM.chatInput.disabled = false;
            DOM.btnSendChat.disabled = false;
            DOM.chatInput.focus();
            isStreaming = false;
            currentAbortController = null;
        }
    }

    async function streamLLM(payload, abortSignal) {
        // Create a new message container for the streaming response
        const p = document.createElement('p');
        p.className = 'message-npc';
        DOM.sceneText.appendChild(p);

        // Cursor effect
        const cursor = document.createElement('span');
        cursor.textContent = '○';
        cursor.style.animation = 'blink 1s infinite';
        p.appendChild(cursor);

        // Timeout handling - 45 seconds max for the entire request
        const timeoutId = setTimeout(() => {
            if (abortSignal && !abortSignal.aborted) {
                console.warn('Stream timeout - request taking too long');
            }
        }, 45000);

        try {
            const response = await fetch(CONFIG.API_URL + '/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: abortSignal
            });

            if (!response.ok) throw new Error(`Stream Error: ${response.status}`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            let fullContent = '';
            let narrativeText = '';
            let lastChunkTime = Date.now();

            try {
                while (true) {
                    // Check for stalled stream (no data for 15 seconds)
                    const timeSinceLastChunk = Date.now() - lastChunkTime;
                    if (timeSinceLastChunk > 15000) {
                        console.warn('Stream stalled - no data received for 15s');
                        p.textContent = '[连接超时，请点击发送重试]';
                        p.style.color = '#ff6b6b';
                        break;
                    }

                    const { done, value } = await reader.read();
                    if (done) break;

                    lastChunkTime = Date.now();
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.trim().startsWith('data: ')) {
                            const dataStr = line.replace('data: ', '').trim();
                            if (dataStr === '[DONE]') break;

                            try {
                                const json = JSON.parse(dataStr);
                                const delta = json.choices[0]?.delta?.content || '';
                                fullContent += delta;

                                // Update narrative (everything before the first ```json)
                                let currentNarrative = fullContent;
                                if (fullContent.includes('```json')) {
                                    currentNarrative = fullContent.split('```json')[0];
                                }

                                // Filter out <think>...</think> blocks for UI display
                                let displayNarrative = currentNarrative;

                                // 1. Remove all complete <think>...</think> blocks
                                displayNarrative = displayNarrative.replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi, '');

                                // 2. If there's an unclosed <think>, hide everything after it
                                if (displayNarrative.includes('<think')) {
                                    displayNarrative = displayNarrative.split(/<\s*think/i)[0];
                                }

                                // 3. Remove any orphaned </think> tags
                                displayNarrative = displayNarrative.replace(/<\s*\/\s*think\s*>/gi, '');

                                displayNarrative = displayNarrative.trim();

                                if (displayNarrative !== narrativeText) {
                                    narrativeText = displayNarrative;
                                    p.textContent = narrativeText;
                                    p.appendChild(cursor);
                                    DOM.sceneText.scrollTo({
                                        top: DOM.sceneText.scrollHeight,
                                        behavior: 'auto' // Use auto for high-frequency streaming updates
                                    });
                                }
                            } catch (e) {
                                // Partial JSON - ignore
                            }
                        }
                    }
                }
            } finally {
                if (p.contains(cursor)) p.removeChild(cursor);
            }

            // Final UI sync
            p.textContent = narrativeText;

            // Log NPC response to history
            const currentScene = scenes.find(s => s.id === worldState.currentSceneId);
            if (narrativeText) {
                addToHistory('npc', narrativeText, currentScene?.title, getNpcLabel(currentScene?.npc));
            }

            // Attempt to parse the full JSON block from fullContent
            const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)(?:```|$)/);
            if (jsonMatch) {
                try {
                    let jsonStr = jsonMatch[1].trim();
                    // Basic sanity check for unclosed JSON
                    if (!jsonStr.endsWith('}')) {
                        jsonStr += (jsonStr.match(/{/g) || []).length > (jsonStr.match(/}/g) || []).length ? '}' : '';
                    }
                    const cleanJsonStr = jsonStr.replace(/:\s*\+(\d+)/g, ':$1');
                    const gameLogic = JSON.parse(cleanJsonStr);
                    if (gameLogic.effects) {
                        applyEffects(gameLogic.effects);
                        renderState();
                    }
                    if (gameLogic.ending) triggerEnding(gameLogic.ending);
                    else if (gameLogic.next) setTimeout(() => advanceToNextScene(gameLogic.next), 1500);
                } catch (e) {
                    console.error("Failed to parse game logic JSON", e);
                }
            }
        } finally {
            clearTimeout(timeoutId);
        }
    }

    function appendMessage(role, text) {
        const p = document.createElement('p');
        p.className = role === 'user' ? 'message-user' : (role === 'system' ? 'message-system' : 'message-npc');
        p.textContent = text;
        DOM.sceneText.appendChild(p);
        DOM.sceneText.scrollTo({
            top: DOM.sceneText.scrollHeight,
            behavior: 'smooth'
        });
    }

    // Flag descriptions for AI context (Shared Knowledge)
    const FLAG_DESCRIPTIONS = {
        met_inspector: "玩家已经见过检票员。",
        stared_inspector: "玩家曾直视检票员的眼睛，引发了警觉。",
        confused_destination: "玩家对目的地表明了困惑。",
        broke_loop_illusion: "玩家试图打破循环的幻象。",
        approached_anomaly: "玩家主动接近了异常乘客。",
        watched_anomaly: "玩家曾远远观察异常乘客。",
        questioned_anomaly: "玩家询问了异常乘客的身份。",
        touched_anomaly: "玩家与异常乘客有过肢体接触。",
        denied_reality: "玩家试图否认眼前的异常现实。",
        talked_to_silent: "玩家尝试与沉默乘客搭话。",
        sat_with_silent: "玩家坐在沉默乘客身边。",
        silent_acknowledged: "沉默乘客对玩家有了回应。",
        saw_note: "玩家发现了隐藏的纸条。",
        has_note: "玩家持有写着真相的纸条。",
        destroyed_note: "玩家销毁了纸条。",
        betrayed_self: "玩家把纸条交给了检票员。",
        mirror_contact: "玩家与窗外的倒影有过互动。",
        broke_boundary: "玩家曾试图敲破车窗离开。"
    };

    const GENDER_MAP = {
        inspector: '男',
        anomaly: '男',
        silent: '女',
        none: '无'
    };

    function constructPrompt(userText) {
        const currentScene = scenes.find(s => s.id === worldState.currentSceneId);
        const npcType = currentScene?.npc || 'none';
        const npcLabel = getNpcLabel(npcType);
        const npcGender = GENDER_MAP[npcType] || '未知';

        const sceneContext = currentScene
            ? `当前场景: "${currentScene.title}"\n场景描述: ${processText(currentScene.text)}\n当前对话NPC: ${npcLabel}${npcLabel ? ` (性别: ${npcGender})` : ''}`
            : "未知场景";

        const statsContext = `
世界状态:
- 循环次数: ${worldState.loop}
- 列车稳定度: ${worldState.train_stability} (越低越危险)
- 现实噪声: ${worldState.reality_noise} (越高越混乱)
- 检票员信任: ${worldState.inspector_trust}
- 异常觉察: ${worldState.anomaly_awareness}
        `.trim();

        // Build known facts from flags
        const knownFacts = Object.entries(worldState.flags)
            .filter(([key, value]) => value && FLAG_DESCRIPTIONS[key])
            .map(([key, value]) => `- ${FLAG_DESCRIPTIONS[key]}`)
            .join('\n');

        const knowledgeContext = knownFacts ? `
【已知情报/历史行为】(你可以基于这些信息与玩家互动，或暗示你知道这些事)
${knownFacts}` : "";

        const systemPrompt = `【身份】你是「夜行列车」的叙述者，冷漠观察一切的声音。

【风格】克苏鲁恐怖，第二人称，简洁留白，感官细节优先。
${knowledgeContext}

【NPC 设定与性别限制 - 严禁混淆】
- 检票员 (inspector)：男性。必须使用代词「他」。机械冷漠，空洞眼神。
- 异常乘客 (anomaly)：男性。必须使用代词「他」。扭曲存在，视线会滑开。
- 沉默乘客 (silent)：女性。必须使用代词「她」。雕像般不动，眼中倒影角度不对。
- 如果当前场景没有明确 NPC，请以旁白视角进行叙述。

【禁止】
⛔ 不说"我是AI"、不用emoji、不用网络用语、不提"游戏/玩家"

${sceneContext}
${statsContext}
${knowledgeContext}

【立绘切换机制 - 必读】
本游戏通过在 JSON 的 "next" 字段返回特定场景 ID 来切换立绘和环境：
- 后缀 _01：默认状态（如 inspector_01）。使用普通、自然的立绘。
- 后缀 _02：警戒/怀疑状态（如 inspector_02）。立绘发生微小偏移或神情变化。
- 后缀 _03：异变/恐怖状态（如 inspector_03）。立绘变得扭曲、崩坏，背景可能切换到异常版本。

【切换指令】
当「现实噪声」> 40 或「列车稳定度」< 40 时，你应当在 JSON 中通过 "next" 字段引导玩家进入带 _02 或 _03 后缀的对应场景（例如从 inspector_01 引导至 inspector_03）。

【输出格式】严格遵守！
1. 叙事（30-80字，纯文本）
2. 换行后JSON块：
\`\`\`json
{"effects":{"train_stability":0,"reality_noise":0,"inspector_trust":0,"anomaly_awareness":0},"next":null,"ending":null}
\`\`\`
- 数值用整数，禁止"+"号
- 必须完整输出JSON，不可截断

【NPC行为约束】你必须遵守以下规则：
1. 禁止：直接解释游戏规则、世界真相、循环机制
2. 禁止：变成问答机器，不能有问必答
3. 当玩家问题偏离核心秘密时：含糊、转移话题、重复之前说过的话、假装没听清
4. 当玩家"接近正确方向"时（涉及列车本质、循环、乘客身份）：
   - 给出更有价值的暗示
   - 态度可以稍微松动
   - 但仍然不能直接说出答案
5. 你的回答应该成为"钩子"，引发玩家好奇，而不是终结对话`;

        // Build conversation history (last 6 exchanges for context)
        const recentHistory = worldState.dialogHistory
            .filter(entry => entry.role === 'user' || entry.role === 'npc')
            .slice(-6)  // Last 6 messages
            .map(entry => ({
                role: entry.role === 'user' ? 'user' : 'assistant',
                content: entry.text
            }));

        // Construct messages array with history
        const messages = [
            { role: "system", content: systemPrompt },
            ...recentHistory,
            { role: "user", content: userText }
        ];

        return {
            messages: messages,
            model: CONFIG.MODEL,
            temperature: 0.6,
            max_tokens: 500,
            stream: true
        };
    }

})();
