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
        // New: Dialog History
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
            condition: (state) => state.sceneCount >= 5
        }
    };

    // ============================================
    // Game State
    // ============================================
    let worldState = null;
    let scenes = [];
    let isTransitioning = false;
    let isStreaming = false;

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

        // Tutorial Elements
        DOM.tutorialOverlay = document.getElementById('tutorial-overlay');
        DOM.btnTutorialStart = document.getElementById('btn-tutorial-start');
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

        // Auto-play BGM interaction check
        document.body.addEventListener('click', ensureBgmPlaying, { once: true });

        // Tutorial Events
        if (DOM.btnTutorialStart) {
            DOM.btnTutorialStart.addEventListener('click', () => toggleTutorial(false));
        }

        // Prevent accidental reset when clicking input
        if (DOM.chatInput) {
            DOM.chatInput.addEventListener('mousedown', (e) => e.stopPropagation());
            DOM.chatInput.addEventListener('click', (e) => e.stopPropagation());
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
    function initAudio() {
        if (worldState.isBgmMuted) {
            DOM.bgm.muted = true;
            DOM.btnBgm.textContent = '🔇 BGM';
            DOM.btnBgm.classList.add('muted');
        } else {
            DOM.bgm.muted = false;
            DOM.btnBgm.textContent = '🔊 BGM';
        }
        DOM.bgm.volume = worldState.bgmVolume || 0.5;
    }

    function ensureBgmPlaying() {
        if (!DOM.bgm.paused) return;
        DOM.bgm.play().catch(e => console.log("Audio autoplay prevented"));
    }

    function toggleBgm() {
        worldState.isBgmMuted = !worldState.isBgmMuted;
        DOM.bgm.muted = worldState.isBgmMuted;

        if (worldState.isBgmMuted) {
            DOM.btnBgm.textContent = '🔇 BGM';
        } else {
            DOM.btnBgm.textContent = '🔊 BGM';
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
        saveState();
        hideEnding();
        renderState();
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

        saveState();
        hideEnding();
        renderState();
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
                element.scrollTop = element.scrollHeight;
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
        return labels[npcType] || npcType || '';
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

        // 1. Check for Dialogue or Event (Explicit type OR label contains quotes)
        const isDialogue = choice.type === 'dialogue' || (!choice.type && /[""“]/.test(choice.label));
        const isEvent = choice.type === 'event';

        if (isDialogue || isEvent) {
            // Apply immediate effects first (if any)
            if (choice.effects) applyEffects(choice.effects);
            if (choice.setFlags) Object.assign(worldState.flags, choice.setFlags);
            renderState();

            // Format for Chat
            const chatText = isEvent ? `*你 ${choice.label}*` : choice.label;

            // Auto-send to Chat
            DOM.chatInput.value = chatText;
            handleChatSubmit();
            return; // Hand over control to LLM/Streaming
        }

        // 2. Standard Action Logic
        if (choice.effects) applyEffects(choice.effects);
        if (choice.setFlags) Object.assign(worldState.flags, choice.setFlags);

        worldState.sceneCount++;
        renderState();

        if (choice.ending) { triggerEnding(choice.ending); return; }
        const ending = checkEndings();
        if (ending) { triggerEnding(ending); return; }
        advanceToNextScene(choice.next, true);
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
        if (!text || isStreaming) return;

        // UI Updates
        DOM.chatInput.value = '';
        DOM.chatInput.disabled = true;
        DOM.btnSendChat.disabled = true;
        ensureBgmPlaying();

        const currentScene = scenes.find(s => s.id === worldState.currentSceneId);

        // Log History
        addToHistory('user', text, currentScene?.title);
        appendMessage('user', text);

        isStreaming = true;
        const prompt = constructPrompt(text);

        try {
            await streamLLM(prompt);
        } catch (error) {
            console.error('LLM Error:', error);
            appendMessage('system', '意识连接断开... (请检查服务器/网络)');
        } finally {
            DOM.chatInput.disabled = false;
            DOM.btnSendChat.disabled = false;
            DOM.chatInput.focus();
            isStreaming = false;
        }
    }

    async function streamLLM(payload) {
        // Create a new message container for the streaming response
        const p = document.createElement('p');
        p.className = 'message-npc';
        DOM.sceneText.appendChild(p);

        // Cursor effect
        const cursor = document.createElement('span');
        cursor.textContent = '▋';
        cursor.style.animation = 'blink 1s infinite';
        p.appendChild(cursor);

        const response = await fetch(CONFIG.API_URL + '/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`Stream Error: ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let fullContent = '';
        let narrativeText = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

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

                            // 1. Remove all complete <think>...</think> blocks (with flexible whitespace)
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
                                DOM.sceneText.scrollTop = DOM.sceneText.scrollHeight;
                            }
                        } catch (e) {
                            // Partials
                        }
                    }
                }
            }
        } finally {
            if (p.contains(cursor)) p.removeChild(cursor);
        }

        // Final UI sync
        p.textContent = narrativeText;

        // Attempt to parse the full JSON block from fullContent
        const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)```/);
        if (jsonMatch) {
            try {
                const cleanJsonStr = jsonMatch[1].replace(/:\s*\+(\d+)/g, ':$1');
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
    }

    function appendMessage(role, text) {
        const p = document.createElement('p');
        p.className = role === 'user' ? 'message-user' : (role === 'system' ? 'message-system' : 'message-npc');
        p.textContent = text;
        DOM.sceneText.appendChild(p);
        DOM.sceneText.scrollTop = DOM.sceneText.scrollHeight;
    }

    function constructPrompt(userText) {
        const currentScene = scenes.find(s => s.id === worldState.currentSceneId);
        const npcLabel = getNpcLabel(currentScene?.npc);
        const npcGender = currentScene?.npc === 'silent' ? '女' : '男';
        const sceneContext = currentScene
            ? `当前场景: "${currentScene.title}"\n场景描述: ${processText(currentScene.text)}\nNPC: ${npcLabel}${npcLabel ? ` (${npcGender}性)` : ''}`
            : "未知场景";

        const statsContext = `
世界状态:
- 循环次数: ${worldState.loop}
- 列车稳定度: ${worldState.train_stability} (越低越危险)
- 现实噪声: ${worldState.reality_noise} (越高越混乱)
- 检票员信任: ${worldState.inspector_trust}
- 异常觉察: ${worldState.anomaly_awareness}
        `.trim();

        const systemPrompt = `【身份】你是「夜行列车」的叙述者，冷漠观察一切的声音。

【风格】克苏鲁恐怖，第二人称，简洁留白，感官细节优先。

【NPC】
- 检票员：机械冷漠，空洞眼神
- 异常乘客：扭曲存在，视线会滑开
- 沉默乘客：雕像般不动，眼中倒影角度不对

【禁止】
⛔ 不说"我是AI"、不用emoji、不用网络用语、不提"游戏/玩家"

${sceneContext}
${statsContext}

【可用场景ID】
start, action_ticket, action_window, rest_transition, walk_away_transition,
inspector_01, inspector_02, inspector_03, anomaly_01, anomaly_02, anomaly_03,
silent_01, silent_02, corridor_01, note_01, window_01

【输入处理】
- 对话：直接回应
- 动作（*xxx*）：描述感官反馈
- 移动/视角（如"走向"、"查看"、"转身"）：必须在next字段指定场景ID

【输出格式】严格遵守！
1. 叙事（30-80字，纯文本）
2. 换行后JSON块：
\`\`\`json
{"effects":{"train_stability":0,"reality_noise":0,"inspector_trust":0,"anomaly_awareness":0},"next":null,"ending":null}
\`\`\`
- 数值用整数，禁止"+"号
- 必须完整输出JSON，不可截断`;

        return {
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userText }
            ],
            model: CONFIG.MODEL,
            temperature: 0.6,
            max_tokens: 500,
            stream: true
        };
    }

})();
