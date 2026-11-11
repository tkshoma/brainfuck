/* =========================================================
   1. 定数・グローバル状態管理
   ========================================================= */
const STORAGE_KEY = 'bf_tester_pro_state_v1';

const bracketColors = [
    '#4ea8de', // 1重: 青系
    '#40c463', // 2重: 緑系
    '#d48844', // 3重: オレンジ系
    '#d4c428', // 4重: マスタードイエロー
    '#ff77cc', // 5重: ピンク
    '#9999ff', // 6重: 青紫色
    '#00ffff', // 7重: 明るい水色
    '#ffffff'  // 8重: 真っ白
];

// フォントサイズ設定
let fontSettings = {
    main: 17,
    sub: 15,
    io: 15,
    memo: 15
};

// 実行エンジン状態
let memory = {};
let ptr = 0;
let lastPtr = 0;
let inputPtr = 0;
let totalSteps = 0;

// メモリセーブスロット (1〜3)
let memorySlots = {
    1: null,
    2: null,
    3: null
};

// メモリページ状態 (Page 0: -100〜100, Page 1: 101〜300...)
let currentMemPage = 0;

// デバッグ（ステップ＆スロー再生）セッション状態
let debugSession = {
    active: false,
    playing: false,
    timerId: null,
    targetId: 'code',
    codeObjects: [],
    jumpMap: {},
    pc: 0,
    inputData: '',
    outputBuffer: '',
    isAppendMode: false,
    history: []
};

/* =========================================================
   2. トースト通知 (alert代替)
   ========================================================= */
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/* =========================================================
   3. 仮想タブ切り替え & ASCII・メモ制御
   ========================================================= */
function switchTab(tabName) {
    const views = {
        ide: document.getElementById('view-ide'),
        ascii: document.getElementById('view-ascii'),
        memo: document.getElementById('view-memo'),
        settings: document.getElementById('view-settings')
    };
    const btns = {
        ide: document.getElementById('tab-btn-ide'),
        ascii: document.getElementById('tab-btn-ascii'),
        memo: document.getElementById('tab-btn-memo'),
        settings: document.getElementById('tab-btn-settings')
    };

    Object.keys(views).forEach(key => {
        if (key === tabName) {
            views[key].classList.remove('hidden');
            btns[key].classList.add('active');
        } else {
            views[key].classList.add('hidden');
            btns[key].classList.remove('active');
        }
    });

    if (tabName === 'ide') {
        refreshAllHighlights();
    } else if (tabName === 'ascii') {
        updateAsciiInspector();
    } else if (tabName === 'memo') {
        updateMemoStats();
    }
}

function setupMemo() {
    const memoArea = document.getElementById('memo-data');
    if (!memoArea) return;

    memoArea.addEventListener('input', () => {
        updateMemoStats();
        saveStateToStorage();
    });

    memoArea.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            insertTextPreservingUndo(this, '    ', 0);
            updateMemoStats();
            saveStateToStorage();
        }
    });

    updateMemoStats();
}

function updateMemoStats() {
    const memoArea = document.getElementById('memo-data');
    const stats = document.getElementById('memo-stats');
    if (!memoArea || !stats) return;

    const val = memoArea.value;
    const lines = val.length === 0 ? 1 : val.split('\n').length;
    stats.innerText = `Length: ${val.length} | Lines: ${lines}`;
}

const controlCharNames = {
    0: ['NUL', 'Null文字'], 1: ['SOH', 'ヘッダ開始'], 2: ['STX', 'テキスト開始'], 3: ['ETX', 'テキスト終了'],
    4: ['EOT', '転送終了'], 5: ['ENQ', '照会'], 6: ['ACK', '肯定応答'], 7: ['BEL', 'ベル (\\a)'],
    8: ['BS', 'バックスペース (\\b)'], 9: ['HT', '水平タブ (\\t)'], 10: ['LF (\\n)', '改行'], 11: ['VT', '垂直タブ'],
    12: ['FF', '改ページ'], 13: ['CR (\\r)', '復帰'], 14: ['SO', 'シフトアウト'], 15: ['SI', 'シフトイン'],
    16: ['DLE', 'データリンク拡張'], 17: ['DC1', '装置制御1'], 18: ['DC2', '装置制御2'], 19: ['DC3', '装置制御3'],
    20: ['DC4', '装置制御4'], 21: ['NAK', '否定応答'], 22: ['SYN', '同期'], 23: ['ETB', '転送ブロック終了'],
    24: ['CAN', '取消'], 25: ['EM', 'メディア終了'], 26: ['SUB', '置換'], 27: ['ESC', 'エスケープ'],
    28: ['FS', 'ファイル区切り'], 29: ['GS', 'グループ区切り'], 30: ['RS', 'レコード区切り'], 31: ['US', 'ユニット区切り'],
    32: ['Space', '空白文字'], 127: ['DEL', '削除']
};

function initAsciiTable() {
    const grid = document.getElementById('ascii-table-grid');
    let html = '';
    for (let i = 0; i <= 127; i++) {
        const hex = '0x' + i.toString(16).toUpperCase().padStart(2, '0');
        let chr = '';
        let desc = '';

        if (controlCharNames[i]) {
            chr = controlCharNames[i][0];
            desc = controlCharNames[i][1];
        } else {
            chr = escapeHtml(String.fromCharCode(i));
        }

        html += `
            <div class="ascii-row">
                <span class="r-dec">${i}</span>
                <span class="r-chr">${chr}</span>
                <span class="r-hex">${hex}</span>
                <span class="r-desc">${desc}</span>
            </div>`;
    }
    grid.innerHTML = html;
    updateAsciiInspector();
}

function updateAsciiInspector() {
    const str = document.getElementById('ascii-inspector-input').value;
    const container = document.getElementById('ascii-breakdown');
    if (!str) {
        container.innerHTML = '';
        return;
    }
    let html = '';
    let prevCode = 0;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        const diff = code - prevCode;
        const diffStr = diff >= 0 ? `+${diff}` : `${diff}`;
        const dispChar = code === 32 ? 'SP' : escapeHtml(str[i]);
        html += `
            <div class="ascii-row">
                <span class="r-idx">#${i + 1}</span>
                <span class="r-chr">${dispChar}</span>
                <span class="r-dec">${code}</span>
                <span class="r-diff">${diffStr}</span>
            </div>`;
        prevCode = code;
    }
    container.innerHTML = html;
}

/* =========================================================
   4. エディタ・シンタックスハイライト・Ctrl+Z保護
   ========================================================= */
function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function countPureCommands(text) {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '>' || c === '<' || c === '+' || c === '-' || c === '.' || c === ',' || c === '[' || c === ']') {
            count++;
        }
    }
    return count;
}

function highlightBrackets(text, cursorPos = -1, execOrigIdx = -1) {
    const unmatched = new Set();
    const stack = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '[') stack.push(i);
        else if (text[i] === ']') {
            if (stack.length === 0) unmatched.add(i);
            else stack.pop();
        }
    }
    for (let index of stack) unmatched.add(index);

    let targetIdx = -1;
    let matchIdx = -1;

    if (cursorPos > 0 && (text[cursorPos - 1] === '[' || text[cursorPos - 1] === ']')) {
        targetIdx = cursorPos - 1;
    }

    if (targetIdx !== -1 && !unmatched.has(targetIdx)) {
        let d = 0;
        if (text[targetIdx] === '[') {
            for (let i = targetIdx; i < text.length; i++) {
                if (text[i] === '[') d++;
                else if (text[i] === ']') d--;
                if (d === 0) { matchIdx = i; break; }
            }
        } else {
            for (let i = targetIdx; i >= 0; i--) {
                if (text[i] === ']') d++;
                else if (text[i] === '[') d--;
                if (d === 0) { matchIdx = i; break; }
            }
        }
    }

    let result = '';
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const isExecPos = (i === execOrigIdx);
        const execClass = isExecPos ? ' class="exec-cursor" id="active-exec-token"' : '';

        let isGlow = (i === targetIdx || i === matchIdx);
        let glowCSS = isGlow ? ' outline: 1px solid rgba(255,255,255,0.45); background-color: rgba(255,255,255,0.12); border-radius: 2px;' : '';

        if (char === '[') {
            if (unmatched.has(i)) {
                result += `<span${execClass} style="color: #ff4d4d; font-weight: bold; background-color: rgba(255,0,0,0.2);${glowCSS}">[</span>`;
            } else {
                result += `<span${execClass} style="color: ${bracketColors[depth % bracketColors.length]}; font-weight: bold;${glowCSS}">[</span>`;
                depth++;
            }
        } else if (char === ']') {
            if (unmatched.has(i)) {
                result += `<span${execClass} style="color: #ff4d4d; font-weight: bold; background-color: rgba(255,0,0,0.2);${glowCSS}">]</span>`;
            } else {
                depth = Math.max(0, depth - 1);
                result += `<span${execClass} style="color: ${bracketColors[depth % bracketColors.length]}; font-weight: bold;${glowCSS}">]</span>`;
            }
        } else if (char === '<' || char === '>') {
            result += `<span${execClass} style="color: #00a8ff; font-weight: bold;">${escapeHtml(char)}</span>`;
        } else if (char === '/') {
            result += `<span${execClass} style="color: #ff5577; font-weight: bold; background-color: rgba(255,85,119,0.18); border-radius: 2px;">/</span>`;
        } else if (isExecPos) {
            result += `<span${execClass}>${escapeHtml(char)}</span>`;
        } else {
            result += escapeHtml(char);
        }
    }
    if (text.endsWith('\n')) result += ' ';
    return result;
}

function updateCodeStats() {
    const textarea = document.getElementById('code');
    const stats = document.getElementById('code-stats');
    if (!textarea || !stats) return;

    const val = textarea.value;
    const pureLen = countPureCommands(val);
    const pos = textarea.selectionStart;

    stats.innerText = `Length: ${val.length} | Pure: ${pureLen} | Pos: ${pos}`;
}

function updateMainEditorHighlight() {
    const textarea = document.getElementById('code');
    const highlightDiv = document.getElementById('code-highlight');
    if (!textarea || !highlightDiv) return;

    const execIdx = (debugSession.active && debugSession.targetId === 'code') ? getCurrentExecOrigIdx() : -1;
    highlightDiv.innerHTML = highlightBrackets(textarea.value, textarea.selectionStart, execIdx);
    updateCodeStats();
}

function insertTextPreservingUndo(textarea, textToInsert, cursorOffsetFromEnd = 0) {
    textarea.focus();
    let inserted = false;
    try {
        inserted = document.execCommand('insertText', false, textToInsert);
    } catch (err) {
        inserted = false;
    }
    if (!inserted) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        textarea.value = val.substring(0, start) + textToInsert + val.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + textToInsert.length;
    }
    if (cursorOffsetFromEnd !== 0) {
        const pos = textarea.selectionEnd + cursorOffsetFromEnd;
        textarea.selectionStart = textarea.selectionEnd = pos;
    }
}

function setupEditor(id) {
    const textarea = document.getElementById(id);
    const highlightDiv = document.getElementById(id + '-highlight');

    const update = () => {
        const execIdx = (debugSession.active && debugSession.targetId === id) ? getCurrentExecOrigIdx() : -1;
        highlightDiv.innerHTML = highlightBrackets(textarea.value, textarea.selectionStart, execIdx);
        if (id === 'code') {
            updateCodeStats();
        } else {
            const statEl = document.getElementById(id + '-stat');
            if (statEl) {
                statEl.innerText = `Pure: ${countPureCommands(textarea.value)}`;
            }
        }
    };

    textarea.addEventListener('input', () => {
        update();
        saveStateToStorage();
    });
    textarea.addEventListener('keyup', update);
    textarea.addEventListener('click', update);
    textarea.addEventListener('focus', update);

    textarea.addEventListener('scroll', () => {
        highlightDiv.scrollTop = textarea.scrollTop;
        highlightDiv.scrollLeft = textarea.scrollLeft;
    });

    textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            insertTextPreservingUndo(this, '    ', 0);
            update();
            saveStateToStorage();
        } else if (e.key === '[') {
            e.preventDefault();
            if (this.selectionStart !== this.selectionEnd) {
                const selected = this.value.substring(this.selectionStart, this.selectionEnd);
                insertTextPreservingUndo(this, '[' + selected + ']', 0);
            } else {
                insertTextPreservingUndo(this, '[]', -1);
            }
            update();
            saveStateToStorage();
        }
    });

    update();
}

function refreshAllHighlights() {
    updateMainEditorHighlight();
    for (let i = 1; i <= 6; i++) {
        const id = 'sub-code' + i;
        const ta = document.getElementById(id);
        const hl = document.getElementById(id + '-highlight');
        if (ta && hl) {
            const execIdx = (debugSession.active && debugSession.targetId === id) ? getCurrentExecOrigIdx() : -1;
            hl.innerHTML = highlightBrackets(ta.value, ta.selectionStart, execIdx);
            const statEl = document.getElementById(id + '-stat');
            if (statEl) statEl.innerText = `Pure: ${countPureCommands(ta.value)}`;
        }
    }
}

/* =========================================================
   5. 追加実行チェックボックス制御 (最大3つ)
   ========================================================= */
function initCheckboxes() {
    const checkboxes = document.querySelectorAll('.sub-chk');
    checkboxes.forEach(chk => {
        chk.addEventListener('change', function() {
            const checkedCount = document.querySelectorAll('.sub-chk:checked').length;
            if (checkedCount > 3) {
                showToast('同時に表示できる追加実行枠は最大3つまでです（非表示にしても内容は保持されます）', 'warn');
                this.checked = false;
                return;
            }
            updateVisibility();
            saveStateToStorage();
        });
    });
    updateVisibility();
}

function updateVisibility() {
    for (let i = 1; i <= 6; i++) {
        const chk = document.getElementById('chk-sub' + i);
        const box = document.getElementById('box-sub' + i);
        if (chk && box) {
            if (chk.checked) box.classList.remove('hidden');
            else box.classList.add('hidden');
        }
    }
}

/* =========================================================
   6. ページ制メモリ管理 (-100〜100, 101〜300...)
   ========================================================= */
function getMem(p) { return memory[p] || 0; }
function setMem(p, v) { memory[p] = v & 255; }

function getPageBounds(page) {
    if (page === 0) return [-100, 100];
    if (page > 0) {
        const start = page * 200 - 99;
        const end = page * 200 + 100;
        return [start, end];
    } else {
        const start = page * 200 - 100;
        const end = page * 200 + 99;
        return [start, end];
    }
}

function getPageForAddress(addr) {
    if (addr >= -100 && addr <= 100) return 0;
    if (addr > 100) return Math.floor((addr - 101) / 200) + 1;
    return -Math.floor((-addr - 101) / 200) - 1;
}

function formatPageNumber(page) {
    if (page >= 0) return `P.${page + 1}`;
    return `P.${page}`;
}

function renderMemoryPage(page = currentMemPage) {
    currentMemPage = page;
    const [startAddr, endAddr] = getPageBounds(page);
    const memoryDiv = document.getElementById('memory');
    const labelEl = document.getElementById('mem-page-label');
    const pageNumEl = document.getElementById('mem-page-num');

    if (labelEl) labelEl.innerText = `${startAddr}〜${endAddr}`;
    if (pageNumEl) pageNumEl.innerText = formatPageNumber(page);

    let htmlString = '';
    for (let i = startAddr; i <= endAddr; i++) {
        const val = getMem(i);
        const isActive = (i === ptr);

        let classes = 'memory-cell';
        if (isActive) classes += ' active';

        htmlString += `
            <div id="cell-${i}" class="${classes}" onclick="selectCellForManualInput(${i})">
                <span class="cell-index">[${i}]</span>
                <span class="cell-value">${val}</span>
            </div>`;
    }
    memoryDiv.innerHTML = htmlString;
}

function changeMemoryPage(delta) {
    renderMemoryPage(currentMemPage + delta);
}

function selectCellForManualInput(addr) {
    document.getElementById('manual-mem-addr').value = addr;
    document.getElementById('manual-mem-val').value = getMem(addr);
    document.getElementById('manual-mem-val').focus();
}

function resetMemoryScroll() {
    if (currentMemPage !== 0) {
        renderMemoryPage(0);
    }
    const memoryDiv = document.getElementById('memory');
    const cellZero = document.getElementById('cell-0');
    if (cellZero) memoryDiv.scrollTop = cellZero.offsetTop - 10;
}

function jumpToPointer() {
    const targetPage = getPageForAddress(ptr);
    if (targetPage !== currentMemPage) {
        renderMemoryPage(targetPage);
    }
    const activeCell = document.getElementById('cell-' + ptr);
    if (activeCell) {
        activeCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function setManualMemory() {
    const addrInput = document.getElementById('manual-mem-addr').value;
    const valInput = document.getElementById('manual-mem-val').value;

    if (addrInput === '' || valInput === '') return;

    const addr = parseInt(addrInput, 10);
    let val = parseInt(valInput, 10);

    if (isNaN(addr) || isNaN(val)) return;

    val = val & 255;
    setMem(addr, val);

    const targetPage = getPageForAddress(addr);
    if (targetPage !== currentMemPage) {
        renderMemoryPage(targetPage);
    } else {
        renderMemoryPage(currentMemPage);
    }

    const cell = document.getElementById('cell-' + addr);
    if (cell) {
        cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const origBg = cell.style.backgroundColor;
        cell.style.backgroundColor = '#d48844';
        setTimeout(() => {
            cell.style.backgroundColor = origBg;
        }, 350);
    }
}

function updateMemorySlotUI() {
    for (let slot = 1; slot <= 3; slot++) {
        const row = document.getElementById('mem-slot-row-' + slot);
        const loadBtn = document.getElementById('btn-load-slot-' + slot);
        const data = memorySlots[slot];
        if (data) {
            row.classList.add('saved');
            loadBtn.classList.add('active-slot');
            const cellCount = Object.keys(data.memory || {}).length;
            loadBtn.title = `スロット${slot}をロード (Ptr: ${data.ptr}, 非ゼロ要素: ${cellCount}個)`;
        } else {
            row.classList.remove('saved');
            loadBtn.classList.remove('active-slot');
            loadBtn.title = `スロット${slot}は未保存です`;
        }
    }
}

function saveMemorySlot(slot) {
    const cleanMem = {};
    for (let k in memory) {
        if (memory[k] !== 0) {
            cleanMem[k] = memory[k] & 255;
        }
    }
    memorySlots[slot] = {
        memory: cleanMem,
        ptr: ptr
    };
    updateMemorySlotUI();
    saveStateToStorage();
    showToast(`現在のメモリ状態を M${slot} にセーブしました (Ptr: ${ptr})`);
}

function loadMemorySlot(slot) {
    const data = memorySlots[slot];
    if (!data) {
        showToast(`M${slot} にはまだメモリがセーブされていません`, 'warn');
        return;
    }
    stopDebugSession();
    memory = { ...data.memory };
    ptr = data.ptr || 0;
    lastPtr = ptr;

    document.getElementById('exec-stats').innerText = `Ptr: ${ptr} | Steps: ${totalSteps}`;

    const autoFollow = document.getElementById('chk-mem-autofollow').checked;
    if (autoFollow) {
        const targetPage = getPageForAddress(ptr);
        renderMemoryPage(targetPage);
        const activeCell = document.getElementById('cell-' + ptr);
        if (activeCell) {
            activeCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    } else {
        renderMemoryPage(currentMemPage);
    }
    showToast(`M${slot} からメモリ状態をロードしました (Ptr: ${ptr})`);
}

/* =========================================================
   7. Brainfuck 構文解析・コード実行
   ========================================================= */
function parseBrackets(codeStr) {
    let map = {};
    let stack = [];
    for (let i = 0; i < codeStr.length; i++) {
        if (codeStr[i] === '[') stack.push(i);
        else if (codeStr[i] === ']') {
            if (stack.length === 0) throw new Error("構文エラー: 対応する '[' がありません");
            let start = stack.pop();
            map[start] = i;
            map[i] = start;
        }
    }
    if (stack.length > 0) throw new Error("構文エラー: 対応する ']' がありません");
    return map;
}

function extractCodeObjects(rawCode) {
    const codeObjects = [];
    for (let i = 0; i < rawCode.length; i++) {
        if ("><+-.,[]/".includes(rawCode[i])) {
            codeObjects.push({ cmd: rawCode[i], origIdx: i });
        }
    }
    return codeObjects;
}

function isStopOnSlashEnabled() {
    const chk = document.getElementById('chk-stop-slash');
    return chk ? chk.checked : false;
}

function getConfiguredInputData() {
    const rawInput = document.getElementById('input-data').value;
    const addNewline = document.getElementById('chk-input-newline').checked;
    return addNewline ? (rawInput + '\n') : rawInput;
}

function executeBrainfuckFromObjects(codeObjects, rawCodeLength, editorId, isAppend) {
    const codeStr = codeObjects.map(o => o.cmd).join('');
    let jumpMap;
    try {
        jumpMap = parseBrackets(codeStr);
    } catch (e) {
        return { output: "\n" + e.message, pausedAtSlash: false };
    }

    let pc = 0;
    let outputText = "";
    let steps = 0;
    const MAX_STEPS = 200000000;
    const inputData = getConfiguredInputData();
    const stopAtSlash = isStopOnSlashEnabled();

    while (pc < codeStr.length) {
        let cmd = codeObjects[pc].cmd;

        if (cmd === '/') {
            if (stopAtSlash) {
                totalSteps += steps;
                const existingOut = isAppend ? document.getElementById('output').textContent : '';
                debugSession.active = true;
                debugSession.playing = false;
                debugSession.targetId = editorId;
                debugSession.codeObjects = codeObjects;
                debugSession.jumpMap = jumpMap;
                debugSession.pc = pc;
                debugSession.inputData = inputData;
                debugSession.outputBuffer = existingOut + outputText;
                debugSession.isAppendMode = isAppend;
                debugSession.history = [];

                const selectVal = editorId === 'code' ? 'main' : editorId.replace('sub-code', 'sub');
                document.getElementById('debug-target').value = selectVal;

                return { output: outputText, pausedAtSlash: true };
            }
            pc++;
            continue;
        }

        if (++steps > MAX_STEPS) {
            let origPos = codeObjects[pc] ? codeObjects[pc].origIdx + 1 : rawCodeLength;
            outputText += `\n[Error] 実行ステップ数が2億回を超過したため強制終了しました。(全体: ${origPos}文字目)`;
            break;
        }

        if (ptr === 50000 || ptr === -50000) {
            let origPos = codeObjects[pc] ? codeObjects[pc].origIdx + 1 : rawCodeLength;
            outputText += `\n[Error] ポインタが限界値(${ptr})に達したため安全のために強制終了しました。(全体: ${origPos}文字目)`;
            break;
        }

        switch (cmd) {
            case '>': ptr++; break;
            case '<': ptr--; break;
            case '+': setMem(ptr, getMem(ptr) + 1); break;
            case '-': setMem(ptr, getMem(ptr) - 1); break;
            case '.': outputText += String.fromCharCode(getMem(ptr)); break;
            case ',':
                if (inputPtr < inputData.length) {
                    setMem(ptr, inputData.charCodeAt(inputPtr++));
                } else {
                    setMem(ptr, 255);
                }
                break;
            case '[':
                if (getMem(ptr) === 0) pc = jumpMap[pc];
                break;
            case ']':
                if (getMem(ptr) !== 0) pc = jumpMap[pc];
                break;
        }
        pc++;
    }

    totalSteps += steps;
    return { output: outputText, pausedAtSlash: false };
}

function updateUI(newOutput, isAppend) {
    const outDiv = document.getElementById('output');
    if (isAppend) {
        outDiv.textContent += newOutput;
    } else {
        outDiv.textContent = newOutput;
    }

    document.getElementById('exec-stats').innerText = `Ptr: ${ptr} | Steps: ${totalSteps}`;

    const autoFollow = document.getElementById('chk-mem-autofollow').checked;
    if (autoFollow) {
        const ptrPage = getPageForAddress(ptr);
        if (ptrPage !== currentMemPage) {
            renderMemoryPage(ptrPage);
        } else {
            renderMemoryPage(currentMemPage);
        }
        const newCell = document.getElementById('cell-' + ptr);
        if (newCell) {
            newCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    } else {
        renderMemoryPage(currentMemPage);
    }
    lastPtr = ptr;
}

function resetEngine(keepDebugStopped = true) {
    if (keepDebugStopped) stopDebugSession();
    memory = {};
    ptr = 0;
    lastPtr = 0;
    inputPtr = 0;
    totalSteps = 0;

    document.getElementById('output').textContent = '';
    document.getElementById('exec-stats').innerText = `Ptr: 0 | Steps: 0`;
    renderMemoryPage(0);
    resetMemoryScroll();
}

function runMain() {
    stopDebugSession();
    resetEngine(false);
    const rawCode = document.getElementById('code').value;
    const codeObjects = extractCodeObjects(rawCode);
    const res = executeBrainfuckFromObjects(codeObjects, rawCode.length, 'code', false);
    updateUI(res.output, false);
    if (res.pausedAtSlash) {
        updateDebugStatusUI();
        refreshAllHighlights();
        scrollEditorToActiveToken();
    }
}

function runSub(num) {
    stopDebugSession();
    const editorId = 'sub-code' + num;
    const rawCode = document.getElementById(editorId).value;
    const codeObjects = extractCodeObjects(rawCode);
    const res = executeBrainfuckFromObjects(codeObjects, rawCode.length, editorId, true);
    updateUI(res.output, true);
    if (res.pausedAtSlash) {
        updateDebugStatusUI();
        refreshAllHighlights();
        scrollEditorToActiveToken();
    }
}

function normalizeCode() {
    stopDebugSession();
    const rawCode = document.getElementById('code').value;
    const pureCode = rawCode.replace(/[^><+\-.,\[\]]/g, '');
    document.getElementById('output').textContent = pureCode;
    document.getElementById('exec-stats').innerText = `正規化完了 (純粋命令: ${pureCode.length}文字)`;
}

/* =========================================================
   8. ステップ実行＆スロー再生エンジン
   ========================================================= */
function getCurrentExecOrigIdx() {
    if (!debugSession.active) return -1;
    const obj = debugSession.codeObjects[debugSession.pc];
    return obj ? obj.origIdx : -1;
}

function getSpeedStepsPerSec() {
    const val = parseFloat(document.getElementById('debug-speed').value);
    if (isNaN(val) || val <= 0) return 1;
    return Math.min(val, 1000000);
}

function updateSpeedLabel() {
    saveStateToStorage();
}

function skipSlashesIfDisabled() {
    if (isStopOnSlashEnabled()) return;
    while (
        debugSession.pc < debugSession.codeObjects.length &&
        debugSession.codeObjects[debugSession.pc].cmd === '/'
    ) {
        debugSession.pc++;
    }
}

function initDebugSession() {
    const targetSelect = document.getElementById('debug-target').value;
    let editorId = 'code';
    let isAppend = false;

    if (targetSelect === 'main') {
        editorId = 'code';
        resetEngine(false);
    } else {
        const subNum = targetSelect.replace('sub', '');
        editorId = 'sub-code' + subNum;
        isAppend = true;
    }

    const textarea = document.getElementById(editorId);
    const rawCode = textarea.value;
    const codeObjects = extractCodeObjects(rawCode);

    if (codeObjects.length === 0) {
        showToast('実行対象のBrainfuck命令がありません', 'warn');
        return false;
    }

    const codeStr = codeObjects.map(o => o.cmd).join('');
    let jumpMap;
    try {
        jumpMap = parseBrackets(codeStr);
    } catch (e) {
        document.getElementById('output').textContent = e.message;
        showToast(e.message, 'warn');
        return false;
    }

    debugSession.active = true;
    debugSession.playing = false;
    debugSession.targetId = editorId;
    debugSession.codeObjects = codeObjects;
    debugSession.jumpMap = jumpMap;
    debugSession.pc = 0;
    debugSession.inputData = getConfiguredInputData();
    debugSession.outputBuffer = isAppend ? document.getElementById('output').textContent : '';
    debugSession.isAppendMode = isAppend;
    debugSession.history = [];

    skipSlashesIfDisabled();
    if (debugSession.pc >= debugSession.codeObjects.length) {
        finishDebugSession();
        return false;
    }

    updateDebugStatusUI();
    refreshAllHighlights();
    scrollEditorToActiveToken();
    return true;
}

function executeSingleStep() {
    if (!debugSession.active) {
        if (!initDebugSession()) return false;
    }

    skipSlashesIfDisabled();

    if (debugSession.pc >= debugSession.codeObjects.length) {
        finishDebugSession();
        return false;
    }

    const currentObj = debugSession.codeObjects[debugSession.pc];
    const cmd = currentObj.cmd;

    if (debugSession.history.length >= 500) debugSession.history.shift();
    debugSession.history.push({
        pc: debugSession.pc,
        ptr: ptr,
        memValAtPtr: getMem(ptr),
        inputPtr: inputPtr,
        totalSteps: totalSteps,
        outputLen: debugSession.outputBuffer.length
    });

    if (cmd === '/') {
        debugSession.pc++;
        skipSlashesIfDisabled();
        if (debugSession.pc >= debugSession.codeObjects.length) {
            updateUI(debugSession.outputBuffer, false);
            finishDebugSession();
            return false;
        }
        if (
            debugSession.playing &&
            isStopOnSlashEnabled() &&
            debugSession.codeObjects[debugSession.pc].cmd === '/'
        ) {
            pauseSlowPlay();
        }
        return true;
    }

    switch (cmd) {
        case '>': ptr++; break;
        case '<': ptr--; break;
        case '+': setMem(ptr, getMem(ptr) + 1); break;
        case '-': setMem(ptr, getMem(ptr) - 1); break;
        case '.':
            debugSession.outputBuffer += String.fromCharCode(getMem(ptr));
            break;
        case ',':
            if (inputPtr < debugSession.inputData.length) {
                setMem(ptr, debugSession.inputData.charCodeAt(inputPtr++));
            } else {
                setMem(ptr, 255);
            }
            break;
        case '[':
            if (getMem(ptr) === 0) debugSession.pc = debugSession.jumpMap[debugSession.pc];
            break;
        case ']':
            if (getMem(ptr) !== 0) debugSession.pc = debugSession.jumpMap[debugSession.pc];
            break;
    }

    debugSession.pc++;
    totalSteps++;

    skipSlashesIfDisabled();

    if (debugSession.pc >= debugSession.codeObjects.length) {
        updateUI(debugSession.outputBuffer, false);
        finishDebugSession();
        return false;
    }

    if (
        debugSession.playing &&
        isStopOnSlashEnabled() &&
        debugSession.codeObjects[debugSession.pc].cmd === '/'
    ) {
        pauseSlowPlay();
    }

    return true;
}

function stepForward() {
    pauseSlowPlay();
    if (!debugSession.active) {
        if (!initDebugSession()) return;
    }
    const cont = executeSingleStep();
    if (cont) {
        updateUI(debugSession.outputBuffer, false);
        updateDebugStatusUI();
        refreshAllHighlights();
        scrollEditorToActiveToken();
    }
}

function stepBackward() {
    pauseSlowPlay();
    if (!debugSession.active || debugSession.history.length === 0) {
        showToast('これ以上前のステップには戻れません', 'warn');
        return;
    }
    const snap = debugSession.history.pop();
    debugSession.pc = snap.pc;
    ptr = snap.ptr;
    setMem(ptr, snap.memValAtPtr);
    inputPtr = snap.inputPtr;
    totalSteps = snap.totalSteps;
    debugSession.outputBuffer = debugSession.outputBuffer.substring(0, snap.outputLen);

    updateUI(debugSession.outputBuffer, false);
    updateDebugStatusUI();
    refreshAllHighlights();
    scrollEditorToActiveToken();
}

function toggleSlowPlay() {
    if (debugSession.playing) {
        pauseSlowPlay();
    } else {
        startSlowPlay();
    }
}

function startSlowPlay() {
    if (!debugSession.active) {
        if (!initDebugSession()) return;
    }
    debugSession.playing = true;
    const btn = document.getElementById('btn-slow-play');
    btn.innerText = '⏸ 一時停止';
    btn.classList.add('playing');
    updateDebugStatusUI();

    let lastTime = performance.now();
    let stepAccumulator = 0;

    function loop(now) {
        if (!debugSession.active || !debugSession.playing) return;
        const dt = (now - lastTime) / 1000;
        lastTime = now;

        const sps = getSpeedStepsPerSec();
        stepAccumulator += dt * sps;

        const stepsToRun = Math.min(Math.floor(stepAccumulator), 20000);
        if (stepsToRun >= 1) {
            stepAccumulator -= stepsToRun;
            for (let i = 0; i < stepsToRun; i++) {
                if (!executeSingleStep()) {
                    return;
                }
                if (!debugSession.playing) {
                    stepAccumulator = 0;
                    break;
                }
            }
            updateUI(debugSession.outputBuffer, false);
            updateDebugStatusUI();
            refreshAllHighlights();
            scrollEditorToActiveToken();
        }

        if (debugSession.active && debugSession.playing) {
            debugSession.timerId = requestAnimationFrame(loop);
        }
    }

    debugSession.timerId = requestAnimationFrame(loop);
}

function pauseSlowPlay() {
    debugSession.playing = false;
    if (debugSession.timerId) {
        cancelAnimationFrame(debugSession.timerId);
        debugSession.timerId = null;
    }
    const btn = document.getElementById('btn-slow-play');
    if (btn) {
        btn.innerText = '▶ スロー再生';
        btn.classList.remove('playing');
    }
    updateDebugStatusUI();
}

function finishDebugSession() {
    pauseSlowPlay();
    debugSession.active = false;
    document.getElementById('debug-status').innerText = `完了 (Steps: ${totalSteps})`;
    refreshAllHighlights();
}

function stopDebugSession() {
    pauseSlowPlay();
    debugSession.active = false;
    debugSession.history = [];
    const statusEl = document.getElementById('debug-status');
    if (statusEl) statusEl.innerText = '待機中';
    refreshAllHighlights();
}

function updateDebugStatusUI() {
    const statusEl = document.getElementById('debug-status');
    if (!debugSession.active) {
        statusEl.innerText = '待機中';
        return;
    }
    const obj = debugSession.codeObjects[debugSession.pc];
    const cmd = obj ? obj.cmd : 'END';
    if (!debugSession.playing && cmd === '/') {
        statusEl.innerText = `一時停止: '/' 到達 (${debugSession.pc + 1}/${debugSession.codeObjects.length})`;
        return;
    }
    const stateLabel = debugSession.playing ? '再生中' : '一時停止';
    statusEl.innerText = `${stateLabel}: 命令 '${cmd}' (${debugSession.pc + 1}/${debugSession.codeObjects.length})`;
}

// 追従がOFFのときはCodeの自動スクロールも行わない
function scrollEditorToActiveToken() {
    const autoFollowChk = document.getElementById('chk-mem-autofollow');
    if (autoFollowChk && !autoFollowChk.checked) return;

    const token = document.getElementById('active-exec-token');
    if (!token) return;
    const textarea = document.getElementById(debugSession.targetId);
    const highlightDiv = document.getElementById(debugSession.targetId + '-highlight');
    if (!textarea || !highlightDiv) return;

    const top = token.offsetTop;
    const viewTop = textarea.scrollTop;
    const viewBottom = viewTop + textarea.clientHeight;

    if (top < viewTop + 24 || top > viewBottom - 36) {
        textarea.scrollTop = Math.max(0, top - textarea.clientHeight / 2);
        highlightDiv.scrollTop = textarea.scrollTop;
    }
}

/* =========================================================
   9. 設定タブ機能 (文字サイズ / スクショ別ウィンドウ / 一括削除)
   ========================================================= */
function clampFontSize(rawVal, defaultVal) {
    const parsed = parseInt(rawVal, 10);
    if (isNaN(parsed)) return defaultVal;
    return Math.max(10, Math.min(36, parsed));
}

function applyFontSettings() {
    document.documentElement.style.setProperty('--main-code-font-size', fontSettings.main + 'px');
    document.documentElement.style.setProperty('--sub-code-font-size', fontSettings.sub + 'px');
    document.documentElement.style.setProperty('--io-font-size', fontSettings.io + 'px');
    document.documentElement.style.setProperty('--memo-font-size', fontSettings.memo + 'px');

    const map = [
        ['setting-main-font', 'setting-main-font-range', fontSettings.main],
        ['setting-sub-font', 'setting-sub-font-range', fontSettings.sub],
        ['setting-io-font', 'setting-io-font-range', fontSettings.io],
        ['setting-memo-font', 'setting-memo-font-range', fontSettings.memo]
    ];
    map.forEach(([numId, rangeId, val]) => {
        const numEl = document.getElementById(numId);
        const rangeEl = document.getElementById(rangeId);
        if (numEl) numEl.value = val;
        if (rangeEl) rangeEl.value = val;
    });
}

// 「適用」ボタンを押したときのみ範囲チェック＆反映を行う
function applyFontSizeFromInputs() {
    fontSettings.main = clampFontSize(document.getElementById('setting-main-font').value, 17);
    fontSettings.sub  = clampFontSize(document.getElementById('setting-sub-font').value, 15);
    fontSettings.io   = clampFontSize(document.getElementById('setting-io-font').value, 15);
    fontSettings.memo = clampFontSize(document.getElementById('setting-memo-font').value, 15);

    applyFontSettings();
    saveStateToStorage();
    showToast('文字サイズを適用しました');
}

function resetFontSizes() {
    fontSettings = { main: 17, sub: 15, io: 15, memo: 15 };
    applyFontSettings();
    saveStateToStorage();
    showToast('文字サイズをデフォルトに戻しました');
}

// 選択された対象（Code / 追加実行 / Output）を別ウィンドウで開く
function openScreenshotWindow() {
    const targetId = document.getElementById('screenshot-target').value;
    openViewerPopup(targetId);
}

function openViewerPopup(targetId) {
    const isOutput = (targetId === 'output');
    let titleLabel = 'Brainfuck Code';
    let statsLabel = '';
    let contentHtml = '';
    let defaultFontSize = fontSettings.main;

    if (isOutput) {
        const outEl = document.getElementById('output');
        // 非表示タブからでも改行コード(\n)が消えないよう textContent で取得
        const rawOut = outEl ? outEl.textContent : '';
        if (!rawOut) {
            showToast('Outputが空です', 'warn');
            return;
        }
        const lines = rawOut.split('\n').length;
        titleLabel = 'Brainfuck Output';
        statsLabel = `Length: ${rawOut.length} | Lines: ${lines} | Ptr: ${ptr} | Steps: ${totalSteps}`;
        contentHtml = escapeHtml(rawOut);
        if (rawOut.endsWith('\n')) contentHtml += ' ';
        defaultFontSize = fontSettings.io;
    } else {
        const mode = document.getElementById('screenshot-mode').value;
        const textarea = document.getElementById(targetId);
        if (!textarea) return;

        const rawText = textarea.value;
        const displayCode = (mode === 'pure') ? rawText.replace(/[^><+\-.,\[\]]/g, '') : rawText;

        if (!displayCode.trim()) {
            showToast('表示するコードが空です', 'warn');
            return;
        }

        const pureCount = countPureCommands(displayCode);
        const totalLen = displayCode.length;
        titleLabel = targetId === 'code' ? 'Brainfuck Code' : `Brainfuck Sub Code (${targetId.replace('sub-code', '追加実行 ')})`;
        statsLabel = `Length: ${totalLen} | Pure: ${pureCount}`;
        contentHtml = highlightBrackets(displayCode, -1, -1);
        defaultFontSize = targetId === 'code' ? fontSettings.main : fontSettings.sub;
    }

    const win = window.open('', '_blank', 'width=900,height=640,menubar=no,toolbar=no,location=no,status=no');
    if (!win) {
        showToast('ポップアップがブロックされました。ブラウザの設定で許可してください', 'warn');
        return;
    }

    const winHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>${titleLabel} Viewer (Read-Only)</title>
    <style>
        :root {
            --vscode-font: Menlo, Monaco, Consolas, "Courier New", monospace;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 20px 24px;
            background-color: #1e1e1e;
            color: #d4d4d4;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
        }
        .viewer-toolbar {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            margin-bottom: 14px;
            padding: 8px 12px;
            background: #252526;
            border: 1px solid #3c3c3c;
            border-radius: 6px;
            font-size: 12px;
        }
        .toolbar-controls {
            display: flex;
            align-items: center;
            gap: 14px;
            flex-wrap: wrap;
        }
        .toolbar-controls label {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            user-select: none;
        }
        .toolbar-controls input[type="number"] {
            width: 58px;
            background: #1e1e1e;
            color: #fff;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 3px 6px;
            font-family: var(--vscode-font);
        }
        .toolbar-btn {
            background: #007acc;
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 5px 10px;
            font-weight: bold;
            cursor: pointer;
            font-size: 12px;
        }
        .toolbar-btn:hover { background: #005f9e; }
        .capture-card {
            background: #1e1e1e;
            border: 1px solid #444;
            border-radius: 8px;
            padding: 20px 24px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.45);
            display: inline-block;
            min-width: 100%;
        }
        .capture-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid #333;
            font-family: var(--vscode-font);
            font-size: 12px;
            color: #9cdcfe;
        }
        .code-view {
            font-family: var(--vscode-font);
            font-size: ${defaultFontSize}px;
            line-height: 1.55;
            white-space: pre-wrap;
            word-break: break-all;
            user-select: text;
        }
        body.clean-mode .viewer-toolbar {
            display: none;
        }
    </style>
</head>
<body>
    <div class="viewer-toolbar" id="toolbar">
        <div class="toolbar-controls">
            <label>文字サイズ:
                <input type="number" id="v-font" value="${defaultFontSize}" min="10" max="48"> px
            </label>
            <label>1行の文字数(0で自動折返し):
                <input type="number" id="v-cols" value="0" min="0" max="300">
            </label>
            <button class="toolbar-btn" onclick="applyViewerSettings()">適用</button>
            <label>
                <input type="checkbox" checked onchange="document.getElementById('cap-header').style.display = this.checked ? 'flex' : 'none'">
                ステータスバーを表示
            </label>
        </div>
        <button class="toolbar-btn" onclick="document.body.classList.add('clean-mode')" title="ダブルクリックでツールバーを再表示できます">ツールバーを隠す (画面ダブルクリックで復帰)</button>
    </div>

    <div class="capture-card" id="capture-card">
        <div class="capture-header" id="cap-header">
            <span>${titleLabel}</span>
            <span>${statsLabel}</span>
        </div>
        <div class="code-view" id="code-box">${contentHtml}</div>
    </div>

    <script>
        function applyViewerSettings() {
            const fontInput = document.getElementById('v-font');
            const colsInput = document.getElementById('v-cols');
            const box = document.getElementById('code-box');
            const card = document.getElementById('capture-card');

            let fSize = parseInt(fontInput.value, 10);
            if (isNaN(fSize)) fSize = ${defaultFontSize};
            fSize = Math.max(10, Math.min(48, fSize));
            fontInput.value = fSize;
            box.style.fontSize = fSize + 'px';

            let cols = parseInt(colsInput.value, 10);
            if (isNaN(cols) || cols <= 0) {
                colsInput.value = 0;
                box.style.width = 'auto';
                card.style.minWidth = '100%';
            } else {
                cols = Math.max(1, Math.min(300, cols));
                colsInput.value = cols;
                box.style.width = cols + 'ch';
                card.style.minWidth = 'unset';
            }
        }
        window.addEventListener('dblclick', () => {
            document.body.classList.remove('clean-mode');
        });
    <\/script>
</body>
</html>`;

    win.document.open();
    win.document.write(winHtml);
    win.document.close();
}

// 一括削除機能群
function clearAllCodes() {
    if (!confirm('メインCode、追加実行1〜6、Inputをすべて削除しますか？\n（メモ・メモリセーブM1〜M3・設定は保持されます）')) return;
    stopDebugSession();
    document.getElementById('code').value = '';
    for (let i = 1; i <= 6; i++) {
        document.getElementById('sub-code' + i).value = '';
    }
    document.getElementById('input-data').value = '';
    resetEngine(false);
    refreshAllHighlights();
    saveStateToStorage();
    showToast('すべてのコードとInputを削除しました');
}

function clearMainCodeOnly() {
    if (!confirm('メインCodeとInputを削除しますか？\n（追加実行1〜6やメモは保持されます）')) return;
    stopDebugSession();
    document.getElementById('code').value = '';
    document.getElementById('input-data').value = '';
    resetEngine(false);
    refreshAllHighlights();
    saveStateToStorage();
    showToast('メインCodeとInputを削除しました');
}

function clearSubCodesOnly() {
    if (!confirm('追加実行1〜6のコードをすべて削除しますか？\n（メインCodeやメモは保持されます）')) return;
    stopDebugSession();
    for (let i = 1; i <= 6; i++) {
        document.getElementById('sub-code' + i).value = '';
    }
    refreshAllHighlights();
    saveStateToStorage();
    showToast('追加実行1〜6のコードを削除しました');
}

function clearMemoOnly() {
    if (!confirm('メモの内容を削除しますか？\n（コードやメモリは保持されます）')) return;
    document.getElementById('memo-data').value = '';
    updateMemoStats();
    saveStateToStorage();
    showToast('メモを削除しました');
}

function factoryResetAll() {
    if (!confirm('【完全初期化】\nすべてのコード、メモ、メモリセーブ(M1〜M3)、文字サイズ設定を含む全データを完全に初期化しますか？')) return;
    stopDebugSession();
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}

    document.getElementById('code').value = '';
    for (let i = 1; i <= 6; i++) {
        document.getElementById('sub-code' + i).value = '';
        document.getElementById('chk-sub' + i).checked = (i <= 3);
    }
    document.getElementById('input-data').value = '';
    document.getElementById('memo-data').value = '';
    document.getElementById('chk-input-newline').checked = true;
    document.getElementById('chk-mem-autofollow').checked = true;
    document.getElementById('chk-stop-slash').checked = true;
    document.getElementById('debug-speed').value = 30;

    memorySlots = { 1: null, 2: null, 3: null };
    fontSettings = { main: 17, sub: 15, io: 15, memo: 15 };

    applyFontSettings();
    updateVisibility();
    updateMemorySlotUI();
    updateMemoStats();
    resetEngine(false);
    refreshAllHighlights();
    saveStateToStorage();
    showToast('全データを完全初期化しました');
}

/* =========================================================
   10. LocalStorage 自動保存・復元
   ========================================================= */
let saveIndicatorTimer = null;

function saveStateToStorage() {
    try {
        const subCodes = {};
        const subChks = {};
        for (let i = 1; i <= 6; i++) {
            subCodes[i] = document.getElementById('sub-code' + i).value;
            subChks[i] = document.getElementById('chk-sub' + i).checked;
        }

        const state = {
            mainCode: document.getElementById('code').value,
            subCodes: subCodes,
            subChks: subChks,
            inputData: document.getElementById('input-data').value,
            memoData: document.getElementById('memo-data').value,
            inputNewline: document.getElementById('chk-input-newline').checked,
            memAutoFollow: document.getElementById('chk-mem-autofollow').checked,
            stopOnSlash: document.getElementById('chk-stop-slash').checked,
            debugSpeed: document.getElementById('debug-speed').value,
            memorySlots: memorySlots,
            fontSettings: fontSettings
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

        const badge = document.getElementById('autosave-status');
        if (badge) {
            badge.innerText = '✓ 自動保存済み';
            badge.style.opacity = '1';
            clearTimeout(saveIndicatorTimer);
            saveIndicatorTimer = setTimeout(() => {
                badge.style.opacity = '0.75';
            }, 1000);
        }
    } catch (e) {
        // Storage制限時などは無視
    }
}

function loadStateFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const state = JSON.parse(raw);

        if (typeof state.mainCode === 'string') {
            document.getElementById('code').value = state.mainCode;
        }
        if (state.subCodes) {
            for (let i = 1; i <= 6; i++) {
                if (typeof state.subCodes[i] === 'string') {
                    document.getElementById('sub-code' + i).value = state.subCodes[i];
                }
            }
        }
        if (state.subChks) {
            let count = 0;
            for (let i = 1; i <= 6; i++) {
                const checked = !!state.subChks[i] && count < 3;
                document.getElementById('chk-sub' + i).checked = checked;
                if (checked) count++;
            }
        }
        if (typeof state.inputData === 'string') {
            document.getElementById('input-data').value = state.inputData;
        }
        if (typeof state.memoData === 'string') {
            document.getElementById('memo-data').value = state.memoData;
        }
        if (typeof state.inputNewline === 'boolean') {
            document.getElementById('chk-input-newline').checked = state.inputNewline;
        }
        if (typeof state.memAutoFollow === 'boolean') {
            document.getElementById('chk-mem-autofollow').checked = state.memAutoFollow;
        }
        if (typeof state.stopOnSlash === 'boolean') {
            document.getElementById('chk-stop-slash').checked = state.stopOnSlash;
        }
        if (state.debugSpeed !== undefined) {
            document.getElementById('debug-speed').value = state.debugSpeed;
        }
        if (state.memorySlots) {
            for (let s = 1; s <= 3; s++) {
                if (state.memorySlots[s]) {
                    memorySlots[s] = state.memorySlots[s];
                }
            }
        }
        if (state.fontSettings) {
            fontSettings = {
                main: state.fontSettings.main || 17,
                sub: state.fontSettings.sub || 15,
                io: state.fontSettings.io || 15,
                memo: state.fontSettings.memo || 15
            };
        }
    } catch (e) {
        // 読み込みエラー時はデフォルト状態を維持
    }
}

/* =========================================================
   11. 初期化処理
   ========================================================= */
window.onload = function() {
    loadStateFromStorage();
    applyFontSettings();
    updateMemorySlotUI();
    renderMemoryPage(0);
    resetMemoryScroll();

    setupEditor('code');
    for (let i = 1; i <= 6; i++) {
        setupEditor('sub-code' + i);
    }
    setupMemo();

    initCheckboxes();
    updateCodeStats();
    initAsciiTable();
};