// imakunAI.js

// --- 設定とグローバル変数 ---
const LLM_API_URL = "https://atjmuwnwmtjw-nose.hf.space/llm/generate";
const LOG_API_URL = "https://atjmuwnwmtjw-nose.hf.space/llm/log_conversation";
const MQTT_API_URL = "https://atjmuwnwmtjw-nose.hf.space/iot/control";
const TARGET_EMAIL = "imakugijikirokusyu@gmail.com";
// public/imakunAI.js
const SNS_POST_API_URL = "https://imakun-sns-worker.cco-api-2025.workers.dev/api/posts";

let recognition = null;
let isListening = false;
let isSpeaking = false;
const synth = window.speechSynthesis;
const chatLog = document.getElementById('chat-log');
const voiceInput = document.getElementById('voice-input');
const sendBtn = document.getElementById('send-btn');
const logBtn = document.getElementById('log-btn');
const sendIcon = document.getElementById('send-icon');
const statusBox = document.getElementById('status');
const messageBox = document.getElementById('message-box');

let chatHistory = [];

// --- UIヘルパー関数 ---
function setStatus(message, isListeningStatus = false) {
    statusBox.textContent = message;
    statusBox.style.opacity = '1';
    sendBtn.classList.toggle('listening', isListeningStatus);
    sendIcon.textContent = isListeningStatus ? '🔴' : '🎤';
}

function setStandbyStatus() {
    setTimeout(() => {
        if (!isListening && !isSpeaking) {
            setStatus('スタンバイ中', false);
        }
    }, 100);
}

function showMessageBox(message) {
    messageBox.textContent = message;
    messageBox.classList.add('visible');
    setTimeout(() => {
        messageBox.classList.remove('visible');
    }, 5000);
}

function appendMessage(role, content) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message', `${role}-message`);
    messageElement.textContent = content;
    chatLog.appendChild(messageElement);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function recordMessage(role, content) {
    chatHistory.push({
        role: role,
        content: content,
        timestamp: Date.now() / 1000
    });
}

// ★ 追加: SNS(Node.jsサーバー)へデータを保存する関数 ★
async function saveToSNS(content) {
    console.log("🚀 SNSサーバーへ保存中...");
    try {
        const response = await fetch(SNS_POST_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ content: content })
        });
        if (response.ok) {
        await fetchTimeline(); // ★ここを追加！投稿したらすぐ画面を更新する
    }

        if (!response.ok) {
            throw new Error(`SNS Save Error: ${response.status}`);
        }

        const data = await response.json();
        console.log("✅ SNS保存成功:", data);
        // ユーザーに通知したい場合はコメントを外してください
        // showMessageBox("SNSに投稿を保存しました");
    } catch (error) {
        console.error("❌ SNS保存失敗:", error);
    }
}

// --- API送信・ログ処理 ---

async function sendLogPerTurn() {
    setStatus('📧 ログを自動送信中...');
    try {
        const response = await fetch(LOG_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                history: chatHistory, 
                target_email: TARGET_EMAIL 
            })
        });

        if (!response.ok) {
            let errorDetail = response.statusText;
            try {
                const errorData = await response.json();
                errorDetail = errorData.detail || JSON.stringify(errorData);
            } catch (e) {
                console.error("エラーレスポンスがJSONではありませんでした:", e);
            }
            throw new Error(`API Error ${response.status}: ${errorDetail}`);
        }
        const data = await response.json();
        console.log(`✅ 自動ログ送信成功: ${data.message}`);
    } catch (error) {
        console.error("自動ログ送信リクエストエラー:", error);
    }
}

async function sendLLMRequest(prompt) {
    if (!prompt.trim()) return;

    appendMessage('user', prompt);
    recordMessage('user', prompt);
    
    setStatus('🤖 応答を生成中...');
    voiceInput.value = '';
    
    try {
        const response = await fetch(LLM_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: prompt, max_length: 1000 })
        });

        if (!response.ok) {
            throw new Error(`API Error ${response.status}`);
        }

        const data = await response.json();
        const aiResponse = data.text;

        appendMessage('ai', aiResponse);
        recordMessage('ai', aiResponse);
        
        speak(aiResponse);

        // ★ ここでSNSサーバーへ保存実行 ★
        // AIの回答を保存するか、prompt(自分の発言)を保存するか選べます
        await saveToSNS(aiResponse); 

        await sendLogPerTurn();

    } catch (error) {
        console.error("LLMリクエストエラー:", error);
        const errorMessage = `エラーが発生しました: ${error.message}`;
        appendMessage('ai', errorMessage);
        speak("システムエラーが発生しました。");
    } finally {
        setStandbyStatus();
    }
}

// --- 音声合成 (TTS) ---
function speak(text) {
    if (synth.speaking) {
        synth.cancel();
    }
    isSpeaking = true;
    setStatus('🔊 発話中...');
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    const preferredVoice = synth.getVoices().find(v => v.lang === 'ja-JP' && v.name.includes('Kyoko'));
    if (preferredVoice) {
        utterance.voice = preferredVoice;
    }
    utterance.onend = () => {
        isSpeaking = false;
        setStandbyStatus();
    };
    utterance.onerror = () => {
        isSpeaking = false;
        setStandbyStatus();
    };
    synth.speak(utterance);
}

// --- 音声認識 (STT) ---
function startRecognition() {
    if (!('webkitSpeechRecognition' in window)) {
        showMessageBox("ブラウザが音声認識に対応していません。");
        return;
    }
    if (recognition) {
        recognition.stop();
        recognition = null;
    }
    recognition = new webkitSpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.interimResults = false;
    recognition.onstart = () => {
        isListening = true;
        setStatus('👂 リスニング中...', true);
    };
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        voiceInput.value = transcript;
        sendLLMRequest(transcript);
    };
    recognition.onerror = (event) => {
        isListening = false;
        setStandbyStatus();
    };
    recognition.onend = () => {
        isListening = false;
        setStandbyStatus();
    };
    recognition.start();
}

// --- イベントリスナー ---
sendBtn.addEventListener("click", () => {
    if (isListening) {
        recognition.stop();
    } else if (voiceInput.value.trim() !== "") {
        sendLLMRequest(voiceInput.value);
    } else {
        startRecognition();
    }
});

voiceInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && voiceInput.value.trim() !== "") {
        sendLLMRequest(voiceInput.value);
    }
});

logBtn.addEventListener("click", async () => {
    if (chatHistory.length === 0) {
        showMessageBox("会話履歴がありません。");
        return;
    }
    setStatus('📧 ログを手動送信中...');
    try {
        const response = await fetch(LOG_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: chatHistory, target_email: TARGET_EMAIL })
        });
        const data = await response.json();
        showMessageBox(`ログ送信完了: ${data.message}`);
    } catch (error) {
        showMessageBox(`エラー: ${error.message}`);
    } finally {
        setStandbyStatus();
    }
});

window.onload = () => {
    if (synth.getVoices().length === 0) {
        window.speechSynthesis.onvoiceschanged = () => setStandbyStatus();
    } else {
        setStandbyStatus();
    }
};

// --- 波形アニメーション ---
const canvas = document.getElementById('waveCanvas');
const ctx = canvas.getContext('2d');
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function drawWave() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (isListening || isSpeaking) {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const time = Date.now() * 0.005;
        for(let i = 0; i < 3; i++) {
            const radius = (50 + i * 20) + Math.sin(time + i * 1.5) * 15;
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            ctx.strokeStyle = isListening ? `rgba(255, 255, 0, ${0.3 - i * 0.1})` : `rgba(0, 128, 255, ${0.3 - i * 0.1})`;
            ctx.lineWidth = 4;
            ctx.stroke();
        }
    }
    requestAnimationFrame(drawWave);
}
drawWave();

// --- タイムライン表示機能 ---
async function fetchTimeline() {
    try {
        const response = await fetch('/api/posts');
        const posts = await response.json();
        
        const timelineList = document.getElementById('timeline-list');
        timelineList.innerHTML = ''; // 一旦クリア

        // 新しい順に表示
        posts.reverse().forEach(post => {
            const postElement = document.createElement('div');
            postElement.className = 'post-item';
            postElement.innerHTML = `
                <div class="post-content">${post.content}</div>
                <div class="post-date">${post.date}</div>
            `;
            timelineList.appendChild(postElement);
        });
    } catch (error) {
        console.error("タイムライン取得失敗:", error);
    }
}

// ページ読み込み時と、投稿後にタイムラインを更新するようにする
window.addEventListener('load', fetchTimeline);