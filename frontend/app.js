/**
 * RPS Arena - ERC-8001 Rock Paper Scissors
 * Frontend Application
 */

// ============================================
// Configuration
// ============================================

const CONFIG = {
    // Update this after deployment
    CONTRACT_ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    
    // Supported networks
    NETWORKS: {
        31337: { name: 'Localhost', symbol: 'ETH' },
        11155111: { name: 'Sepolia', symbol: 'ETH' },
        84532: { name: 'Base Sepolia', symbol: 'ETH' }
    }
};

const CONTRACT_ABI = [
    // Events
    "event CoordinationProposed(bytes32 indexed intentHash, address indexed agentId, address indexed opponent, uint256 wager, uint64 expiry)",
    "event CoordinationAccepted(bytes32 indexed intentHash, address indexed participant, bytes32 commitment)",
    "event CoordinationExecuted(bytes32 indexed intentHash, uint8 result, address winner)",
    "event CoordinationCancelled(bytes32 indexed intentHash, address cancelledBy)",
    "event MoveRevealed(bytes32 indexed intentHash, address indexed player, uint8 move)",
    
    // Read functions
    "function games(bytes32) view returns (address player1, address player2, uint256 wager, uint64 expiry, uint64 revealDeadline, uint8 status, bytes32 player1Commitment, bytes32 player2Commitment, uint8 player1Move, uint8 player2Move, uint8 result)",
    "function getGame(bytes32) view returns (address player1, address player2, uint256 wager, uint64 expiry, uint64 revealDeadline, uint8 status, bool player1Committed, bool player2Committed, uint8 player1Move, uint8 player2Move, uint8 result)",
    "function getPlayerGames(address) view returns (bytes32[])",
    "function getCoordinationStatus(bytes32) view returns (uint8)",
    "function agentNonces(address) view returns (uint64)",
    "function DOMAIN_SEPARATOR() view returns (bytes32)",
    "function COORDINATION_TYPE() view returns (bytes32)",
    
    // Write functions
    "function proposeCoordination((bytes32 payloadHash, uint64 expiry, uint64 nonce, address agentId, bytes32 coordinationType, uint256 coordinationValue, address[] participants), bytes signature) payable returns (bytes32)",
    "function acceptCoordination((bytes32 intentHash, address participant, uint64 nonce, uint64 expiry, bytes32 conditionsHash, bytes signature)) payable returns (bool)",
    "function revealMove(bytes32 intentHash, uint8 move, bytes32 salt)",
    "function cancelCoordination(bytes32 intentHash)"
];

// Game Status enum
const GameStatus = {
    None: 0,
    Proposed: 1,
    BothCommitted: 2,
    Revealed: 3,
    Completed: 4,
    Cancelled: 5
};

const GameStatusNames = ['None', 'Proposed', 'Committed', 'Revealed', 'Completed', 'Cancelled'];

// Move enum
const Move = {
    None: 0,
    Rock: 1,
    Paper: 2,
    Scissors: 3
};

const MoveEmoji = ['❓', '✊', '✋', '✌️'];
const MoveNames = ['None', 'Rock', 'Paper', 'Scissors'];

// Result enum
const Result = {
    Pending: 0,
    Player1Wins: 1,
    Player2Wins: 2,
    Draw: 3
};

// ============================================
// State
// ============================================

let provider = null;
let signer = null;
let contract = null;
let userAddress = null;
let chainId = null;

// Current game state
let currentGame = {
    intentHash: null,
    move: null,
    salt: null,
    isPlayer1: false
};

// Stored commitments (in real app, persist to localStorage)
const storedCommitments = new Map();

// ============================================
// DOM Elements
// ============================================

const elements = {
    // Screens
    connectScreen: document.getElementById('connectScreen'),
    lobbyScreen: document.getElementById('lobbyScreen'),
    newGameScreen: document.getElementById('newGameScreen'),
    joinGameScreen: document.getElementById('joinGameScreen'),
    gameScreen: document.getElementById('gameScreen'),
    myGamesScreen: document.getElementById('myGamesScreen'),
    resultScreen: document.getElementById('resultScreen'),
    
    // Header
    walletStatus: document.getElementById('walletStatus'),
    
    // Connect screen
    connectBtn: document.getElementById('connectBtn'),
    
    // Lobby
    playerAddress: document.getElementById('playerAddress'),
    playerBalance: document.getElementById('playerBalance'),
    playerAvatar: document.getElementById('playerAvatar'),
    newGameBtn: document.getElementById('newGameBtn'),
    joinGameBtn: document.getElementById('joinGameBtn'),
    myGamesBtn: document.getElementById('myGamesBtn'),
    
    // New game
    opponentAddress: document.getElementById('opponentAddress'),
    wagerAmount: document.getElementById('wagerAmount'),
    createGameBtn: document.getElementById('createGameBtn'),
    backToLobbyBtn: document.getElementById('backToLobbyBtn'),
    
    // Join game
    gameIdInput: document.getElementById('gameIdInput'),
    gamePreview: document.getElementById('gamePreview'),
    previewChallenger: document.getElementById('previewChallenger'),
    previewWager: document.getElementById('previewWager'),
    previewExpiry: document.getElementById('previewExpiry'),
    joinMoveSelection: document.getElementById('joinMoveSelection'),
    loadGameBtn: document.getElementById('loadGameBtn'),
    acceptGameBtn: document.getElementById('acceptGameBtn'),
    backFromJoinBtn: document.getElementById('backFromJoinBtn'),
    
    // Game screen
    currentGameId: document.getElementById('currentGameId'),
    currentPot: document.getElementById('currentPot'),
    currentStatus: document.getElementById('currentStatus'),
    timeLeft: document.getElementById('timeLeft'),
    yourMoveDisplay: document.getElementById('yourMoveDisplay'),
    opponentMoveDisplay: document.getElementById('opponentMoveDisplay'),
    yourStatus: document.getElementById('yourStatus'),
    opponentStatus: document.getElementById('opponentStatus'),
    revealBtn: document.getElementById('revealBtn'),
    refreshGameBtn: document.getElementById('refreshGameBtn'),
    backFromGameBtn: document.getElementById('backFromGameBtn'),
    
    // My games
    gamesList: document.getElementById('gamesList'),
    refreshGamesBtn: document.getElementById('refreshGamesBtn'),
    backFromGamesBtn: document.getElementById('backFromGamesBtn'),
    
    // Result
    resultTitle: document.getElementById('resultTitle'),
    resultMove1: document.getElementById('resultMove1'),
    resultMove2: document.getElementById('resultMove2'),
    resultPrize: document.getElementById('resultPrize'),
    playAgainBtn: document.getElementById('playAgainBtn'),
    
    // Footer
    networkName: document.getElementById('networkName'),
    contractAddress: document.getElementById('contractAddress'),
    
    // Overlays
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
    toastContainer: document.getElementById('toastContainer'),
    
    // Debug panel
    debugPanel: document.getElementById('debugPanel'),
    debugToggle: document.getElementById('debugToggle'),
    debugContent: document.getElementById('debugContent'),
    debugAddress: document.getElementById('debugAddress'),
    debugChainId: document.getElementById('debugChainId'),
    debugNonce: document.getElementById('debugNonce'),
    debugContract: document.getElementById('debugContract'),
    debugDomain: document.getElementById('debugDomain'),
    debugIntentHash: document.getElementById('debugIntentHash'),
    debugYourCommitment: document.getElementById('debugYourCommitment'),
    debugYourSalt: document.getElementById('debugYourSalt'),
    debugYourMove: document.getElementById('debugYourMove'),
    debugIsPlayer1: document.getElementById('debugIsPlayer1'),
    debugPlayer1: document.getElementById('debugPlayer1'),
    debugPlayer2: document.getElementById('debugPlayer2'),
    debugWager: document.getElementById('debugWager'),
    debugStatus: document.getElementById('debugStatus'),
    debugP1Committed: document.getElementById('debugP1Committed'),
    debugP2Committed: document.getElementById('debugP2Committed'),
    debugP1Move: document.getElementById('debugP1Move'),
    debugP2Move: document.getElementById('debugP2Move'),
    debugResult: document.getElementById('debugResult'),
    debugExpiry: document.getElementById('debugExpiry'),
    debugRevealDeadline: document.getElementById('debugRevealDeadline'),
    debugLastTx: document.getElementById('debugLastTx'),
    debugLog: document.getElementById('debugLog')
};

// ============================================
// Utilities
// ============================================

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function showLoading(text = 'PROCESSING...') {
    elements.loadingText.textContent = text;
    elements.loadingOverlay.classList.add('active');
}

function hideLoading() {
    elements.loadingOverlay.classList.remove('active');
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    elements.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function shortenAddress(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatEth(wei) {
    return parseFloat(ethers.utils.formatEther(wei)).toFixed(4);
}

function generateSalt() {
    return ethers.utils.hexlify(ethers.utils.randomBytes(32));
}

function createCommitment(move, salt) {
    return ethers.utils.solidityKeccak256(
        ['uint8', 'bytes32'],
        [move, salt]
    );
}

function generatePixelAvatar(address) {
    // Simple deterministic pixel art based on address
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    const seed = parseInt(address.slice(2, 10), 16);
    const colors = [
        '#ff2d95', '#00fff2', '#ffd93d', '#39ff14', '#bf00ff'
    ];
    
    ctx.fillStyle = '#12121a';
    ctx.fillRect(0, 0, 64, 64);
    
    for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 16; j++) {
            if ((seed >> ((i * 16 + j) % 32)) & 1) {
                ctx.fillStyle = colors[(i + j + seed) % colors.length];
                ctx.fillRect(i * 4, j * 4, 4, 4);
            }
        }
    }
    
    return canvas.toDataURL();
}

// ============================================
// Debug Functions
// ============================================

function debugLog(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
    
    // Remove "waiting" message if present
    const waiting = elements.debugLog.querySelector('.log-entry:only-child');
    if (waiting && waiting.textContent.includes('Waiting')) {
        waiting.remove();
    }
    
    elements.debugLog.insertBefore(entry, elements.debugLog.firstChild);
    
    // Keep only last 50 entries
    while (elements.debugLog.children.length > 50) {
        elements.debugLog.removeChild(elements.debugLog.lastChild);
    }
    
    console.log(`[DEBUG ${type.toUpperCase()}]`, message);
}

function updateDebugWallet() {
    if (!userAddress) return;
    
    elements.debugAddress.textContent = userAddress;
    elements.debugChainId.textContent = chainId;
    elements.debugContract.textContent = CONFIG.CONTRACT_ADDRESS;
}

async function updateDebugNonce() {
    if (!contract || !userAddress) return;
    
    try {
        const nonce = await contract.agentNonces(userAddress);
        elements.debugNonce.textContent = nonce.toString();
    } catch (e) {
        elements.debugNonce.textContent = 'Error';
    }
}

async function updateDebugDomain() {
    if (!contract) return;
    
    try {
        const domain = await contract.DOMAIN_SEPARATOR();
        elements.debugDomain.textContent = domain;
    } catch (e) {
        elements.debugDomain.textContent = 'Error';
    }
}

function updateDebugCurrentGame() {
    elements.debugIntentHash.textContent = currentGame.intentHash || '---';
    elements.debugIntentHash.classList.toggle('highlight', !!currentGame.intentHash);
    
    if (currentGame.salt) {
        elements.debugYourSalt.textContent = currentGame.salt;
    } else {
        elements.debugYourSalt.textContent = '---';
    }
    
    if (currentGame.move) {
        const commitment = createCommitment(currentGame.move, currentGame.salt);
        elements.debugYourCommitment.textContent = commitment;
        elements.debugYourMove.textContent = `${currentGame.move} (${MoveNames[currentGame.move]})`;
    } else {
        elements.debugYourCommitment.textContent = '---';
        elements.debugYourMove.textContent = '---';
    }
    
    elements.debugIsPlayer1.textContent = currentGame.isPlayer1 ? 'YES' : 'NO';
}

function updateDebugGameState(game) {
    if (!game) {
        elements.debugPlayer1.textContent = '---';
        elements.debugPlayer2.textContent = '---';
        elements.debugWager.textContent = '---';
        elements.debugStatus.textContent = '---';
        elements.debugP1Committed.textContent = '---';
        elements.debugP2Committed.textContent = '---';
        elements.debugP1Move.textContent = '---';
        elements.debugP2Move.textContent = '---';
        elements.debugResult.textContent = '---';
        elements.debugExpiry.textContent = '---';
        elements.debugRevealDeadline.textContent = '---';
        return;
    }
    
    elements.debugPlayer1.textContent = game.player1;
    elements.debugPlayer2.textContent = game.player2;
    elements.debugWager.textContent = `${formatEth(game.wager)} ETH (${game.wager.toString()} wei)`;
    elements.debugStatus.textContent = `${game.status} (${GameStatusNames[game.status]})`;
    elements.debugP1Committed.textContent = game.player1Committed ? 'YES ✓' : 'NO';
    elements.debugP2Committed.textContent = game.player2Committed ? 'YES ✓' : 'NO';
    elements.debugP1Move.textContent = game.player1Move > 0 ? `${game.player1Move} (${MoveNames[game.player1Move]})` : '---';
    elements.debugP2Move.textContent = game.player2Move > 0 ? `${game.player2Move} (${MoveNames[game.player2Move]})` : '---';
    elements.debugResult.textContent = ['Pending', 'Player1 Wins', 'Player2 Wins', 'Draw'][game.result];
    elements.debugExpiry.textContent = new Date(game.expiry * 1000).toLocaleString();
    elements.debugRevealDeadline.textContent = game.revealDeadline > 0 
        ? new Date(game.revealDeadline * 1000).toLocaleString() 
        : '---';
}

function updateDebugLastTx(txHash) {
    elements.debugLastTx.textContent = txHash;
    debugLog(`TX: ${txHash}`, 'success');
}

function copyToClipboard(text, element) {
    navigator.clipboard.writeText(text).then(() => {
        // Show tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'copy-tooltip';
        tooltip.textContent = 'Copied!';
        
        const rect = element.getBoundingClientRect();
        tooltip.style.left = `${rect.left}px`;
        tooltip.style.top = `${rect.top - 30}px`;
        
        document.body.appendChild(tooltip);
        
        setTimeout(() => tooltip.remove(), 1000);
    }).catch(err => {
        console.error('Copy failed:', err);
    });
}

// ============================================
// Wallet Connection
// ============================================

async function connectWallet() {
    if (!window.ethereum) {
        showToast('Please install MetaMask!', 'error');
        return;
    }
    
    try {
        showLoading('CONNECTING...');
        debugLog('Connecting wallet...', 'info');
        
        provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        
        signer = provider.getSigner();
        userAddress = await signer.getAddress();
        chainId = (await provider.getNetwork()).chainId;
        
        debugLog(`Connected: ${shortenAddress(userAddress)}`, 'success');
        debugLog(`Chain ID: ${chainId}`, 'info');
        
        contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONTRACT_ABI, signer);
        
        // Update debug panel
        updateDebugWallet();
        updateDebugNonce();
        updateDebugDomain();
        
        // Update UI
        elements.walletStatus.classList.add('connected');
        elements.walletStatus.querySelector('.status-text').textContent = shortenAddress(userAddress);
        
        elements.playerAddress.textContent = shortenAddress(userAddress);
        elements.playerAvatar.style.backgroundImage = `url(${generatePixelAvatar(userAddress)})`;
        elements.playerAvatar.style.backgroundSize = 'cover';
        
        const balance = await provider.getBalance(userAddress);
        elements.playerBalance.textContent = formatEth(balance);
        
        // Network info
        const network = CONFIG.NETWORKS[chainId] || { name: `Chain ${chainId}` };
        elements.networkName.textContent = network.name;
        elements.contractAddress.textContent = shortenAddress(CONFIG.CONTRACT_ADDRESS);
        
        showScreen('lobbyScreen');
        showToast('Wallet connected!', 'success');
        
        // Listen for account changes
        window.ethereum.on('accountsChanged', handleAccountChange);
        window.ethereum.on('chainChanged', () => window.location.reload());
        
    } catch (error) {
        console.error('Connection error:', error);
        debugLog(`Connection error: ${error.message}`, 'error');
        showToast('Failed to connect wallet', 'error');
    } finally {
        hideLoading();
    }
}

function handleAccountChange(accounts) {
    if (accounts.length === 0) {
        showScreen('connectScreen');
        elements.walletStatus.classList.remove('connected');
    } else {
        window.location.reload();
    }
}

// ============================================
// EIP-712 Signing
// ============================================

async function signIntent(intent) {
    const domain = {
        name: 'RockPaperScissorsERC8001',
        version: '1',
        chainId: chainId,
        verifyingContract: CONFIG.CONTRACT_ADDRESS
    };
    
    const types = {
        AgentIntent: [
            { name: 'payloadHash', type: 'bytes32' },
            { name: 'expiry', type: 'uint64' },
            { name: 'nonce', type: 'uint64' },
            { name: 'agentId', type: 'address' },
            { name: 'coordinationType', type: 'bytes32' },
            { name: 'coordinationValue', type: 'uint256' },
            { name: 'participants', type: 'address[]' }
        ]
    };
    
    return await signer._signTypedData(domain, types, intent);
}

async function signAcceptance(acceptance) {
    const domain = {
        name: 'RockPaperScissorsERC8001',
        version: '1',
        chainId: chainId,
        verifyingContract: CONFIG.CONTRACT_ADDRESS
    };
    
    const types = {
        AcceptanceAttestation: [
            { name: 'intentHash', type: 'bytes32' },
            { name: 'participant', type: 'address' },
            { name: 'nonce', type: 'uint64' },
            { name: 'expiry', type: 'uint64' },
            { name: 'conditionsHash', type: 'bytes32' }
        ]
    };
    
    // Sign without the signature field
    const toSign = {
        intentHash: acceptance.intentHash,
        participant: acceptance.participant,
        nonce: acceptance.nonce,
        expiry: acceptance.expiry,
        conditionsHash: acceptance.conditionsHash
    };
    
    return await signer._signTypedData(domain, types, toSign);
}

// ============================================
// Game Functions
// ============================================

async function createGame() {
    const opponent = elements.opponentAddress.value.trim();
    const wagerEth = elements.wagerAmount.value;
    const selectedMove = document.querySelector('#newGameScreen .move-btn.selected');
    
    if (!ethers.utils.isAddress(opponent)) {
        showToast('Invalid opponent address', 'error');
        return;
    }
    
    if (!selectedMove) {
        showToast('Please select your move', 'error');
        return;
    }
    
    const move = parseInt(selectedMove.dataset.move);
    const wagerWei = ethers.utils.parseEther(wagerEth);
    
    debugLog(`Creating game vs ${shortenAddress(opponent)}`, 'info');
    debugLog(`Wager: ${wagerEth} ETH, Move: ${MoveNames[move]}`, 'info');
    
    try {
        showLoading('CREATING GAME...');
        
        // Get coordination type
        const coordinationType = await contract.COORDINATION_TYPE();
        
        // Get current nonce
        const currentNonce = await contract.agentNonces(userAddress);
        const nonce = currentNonce.add(1);
        
        debugLog(`Using nonce: ${nonce.toString()}`, 'info');
        
        // Sort participants (ERC-8001 requirement)
        const participants = [userAddress, opponent].sort((a, b) => 
            a.toLowerCase().localeCompare(b.toLowerCase())
        );
        
        debugLog(`Participants (sorted): ${participants.map(p => shortenAddress(p)).join(', ')}`, 'info');
        
        // Create intent
        const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour
        
        const intent = {
            payloadHash: ethers.constants.HashZero,
            expiry: expiry,
            nonce: nonce,
            agentId: userAddress,
            coordinationType: coordinationType,
            coordinationValue: wagerWei,
            participants: participants
        };
        
        // Sign intent
        showLoading('SIGN IN WALLET...');
        debugLog('Requesting EIP-712 signature for intent...', 'info');
        const signature = await signIntent(intent);
        debugLog('Intent signed', 'success');
        
        // Submit transaction
        showLoading('SUBMITTING...');
        const tx = await contract.proposeCoordination(intent, signature, { value: wagerWei });
        debugLog(`Propose TX submitted: ${tx.hash}`, 'info');
        updateDebugLastTx(tx.hash);
        
        showLoading('CONFIRMING...');
        const receipt = await tx.wait();
        debugLog(`Propose TX confirmed in block ${receipt.blockNumber}`, 'success');
        
        // Get intent hash from event
        const event = receipt.events.find(e => e.event === 'CoordinationProposed');
        const intentHash = event.args.intentHash;
        
        debugLog(`Game created! Intent Hash: ${intentHash}`, 'success');
        
        // Generate commitment
        const salt = generateSalt();
        const commitment = createCommitment(move, salt);
        
        debugLog(`Commitment generated: ${shortenAddress(commitment)}`, 'info');
        
        // Store commitment for later reveal
        storedCommitments.set(intentHash, { move, salt });
        localStorage.setItem(`rps_${intentHash}`, JSON.stringify({ move, salt }));
        
        // Now accept with our commitment
        showLoading('COMMITTING MOVE...');
        
        const acceptanceExpiry = Math.floor(Date.now() / 1000) + 3600;
        
        const acceptance = {
            intentHash: intentHash,
            participant: userAddress,
            nonce: 1,
            expiry: acceptanceExpiry,
            conditionsHash: commitment
        };
        
        const acceptSig = await signAcceptance(acceptance);
        acceptance.signature = acceptSig;
        
        const acceptTx = await contract.acceptCoordination(acceptance);
        debugLog(`Accept TX submitted: ${acceptTx.hash}`, 'info');
        updateDebugLastTx(acceptTx.hash);
        
        const acceptReceipt = await acceptTx.wait();
        debugLog(`Move committed in block ${acceptReceipt.blockNumber}`, 'success');
        
        currentGame.intentHash = intentHash;
        currentGame.move = move;
        currentGame.salt = salt;
        currentGame.isPlayer1 = true;
        
        // Update debug panel
        updateDebugCurrentGame();
        updateDebugNonce();
        
        showToast('Game created! Share ID with opponent', 'success');
        
        // Show game screen
        loadGameScreen(intentHash);
        
    } catch (error) {
        console.error('Create game error:', error);
        showToast(error.reason || 'Failed to create game', 'error');
    } finally {
        hideLoading();
    }
}

async function loadGamePreview() {
    const gameId = elements.gameIdInput.value.trim();
    
    if (!gameId || !gameId.startsWith('0x')) {
        showToast('Invalid game ID', 'error');
        return;
    }
    
    try {
        showLoading('LOADING...');
        
        const game = await contract.getGame(gameId);
        
        if (game.status === GameStatus.None) {
            showToast('Game not found', 'error');
            return;
        }
        
        elements.gamePreview.style.display = 'block';
        elements.previewChallenger.textContent = shortenAddress(game.player1);
        elements.previewWager.textContent = `${formatEth(game.wager)} ETH`;
        elements.previewExpiry.textContent = new Date(game.expiry * 1000).toLocaleString();
        
        // Check if user is a participant
        const isPlayer1 = game.player1.toLowerCase() === userAddress.toLowerCase();
        const isPlayer2 = game.player2.toLowerCase() === userAddress.toLowerCase();
        
        if (!isPlayer1 && !isPlayer2) {
            showToast('You are not a participant in this game', 'error');
            return;
        }
        
        // If player hasn't committed yet, show move selection
        if ((isPlayer1 && !game.player1Committed) || (isPlayer2 && !game.player2Committed)) {
            elements.joinMoveSelection.style.display = 'block';
            elements.acceptGameBtn.style.display = 'inline-block';
        } else {
            // Player already committed, go directly to game
            loadGameScreen(gameId);
        }
        
    } catch (error) {
        console.error('Load game error:', error);
        showToast('Failed to load game', 'error');
    } finally {
        hideLoading();
    }
}

async function acceptGame() {
    const gameId = elements.gameIdInput.value.trim();
    const selectedMove = document.querySelector('#joinGameScreen .move-btn.selected');
    
    if (!selectedMove) {
        showToast('Please select your move', 'error');
        return;
    }
    
    const move = parseInt(selectedMove.dataset.move);
    
    debugLog(`Accepting game: ${shortenAddress(gameId)}`, 'info');
    debugLog(`Selected move: ${MoveNames[move]}`, 'info');
    
    try {
        showLoading('ACCEPTING...');
        
        const game = await contract.getGame(gameId);
        
        // Generate commitment
        const salt = generateSalt();
        const commitment = createCommitment(move, salt);
        
        debugLog(`Generated commitment: ${shortenAddress(commitment)}`, 'info');
        
        // Store for later
        storedCommitments.set(gameId, { move, salt });
        localStorage.setItem(`rps_${gameId}`, JSON.stringify({ move, salt }));
        
        const acceptanceExpiry = Math.floor(Date.now() / 1000) + 3600;
        
        const acceptance = {
            intentHash: gameId,
            participant: userAddress,
            nonce: 1,
            expiry: acceptanceExpiry,
            conditionsHash: commitment
        };
        
        showLoading('SIGN IN WALLET...');
        debugLog('Requesting EIP-712 signature for acceptance...', 'info');
        const signature = await signAcceptance(acceptance);
        acceptance.signature = signature;
        debugLog('Acceptance signed', 'success');
        
        showLoading('SUBMITTING...');
        
        // Determine if we need to send wager
        const isPlayer2 = game.player2.toLowerCase() === userAddress.toLowerCase();
        const value = isPlayer2 ? game.wager : 0;
        
        debugLog(`Sending ${isPlayer2 ? formatEth(game.wager) + ' ETH' : '0 ETH'} (Player ${isPlayer2 ? '2' : '1'})`, 'info');
        
        const tx = await contract.acceptCoordination(acceptance, { value });
        debugLog(`Accept TX submitted: ${tx.hash}`, 'info');
        updateDebugLastTx(tx.hash);
        
        const receipt = await tx.wait();
        debugLog(`Move committed in block ${receipt.blockNumber}`, 'success');
        
        currentGame.intentHash = gameId;
        currentGame.move = move;
        currentGame.salt = salt;
        currentGame.isPlayer1 = !isPlayer2;
        
        updateDebugCurrentGame();
        
        showToast('Move committed!', 'success');
        loadGameScreen(gameId);
        
    } catch (error) {
        console.error('Accept error:', error);
        debugLog(`Accept error: ${error.reason || error.message}`, 'error');
        showToast(error.reason || 'Failed to accept game', 'error');
    } finally {
        hideLoading();
    }
}

async function loadGameScreen(intentHash) {
    currentGame.intentHash = intentHash;
    
    debugLog(`Loading game: ${intentHash}`, 'info');
    
    // Try to load stored commitment
    const stored = localStorage.getItem(`rps_${intentHash}`);
    if (stored) {
        const { move, salt } = JSON.parse(stored);
        currentGame.move = move;
        currentGame.salt = salt;
        debugLog(`Loaded stored commitment for move: ${MoveNames[move]}`, 'info');
    }
    
    await refreshGameState();
    showScreen('gameScreen');
}

async function refreshGameState() {
    if (!currentGame.intentHash) return;
    
    try {
        const game = await contract.getGame(currentGame.intentHash);
        
        const isPlayer1 = game.player1.toLowerCase() === userAddress.toLowerCase();
        currentGame.isPlayer1 = isPlayer1;
        
        // Update debug panel with game state
        updateDebugCurrentGame();
        updateDebugGameState(game);
        
        // Update UI
        elements.currentGameId.textContent = shortenAddress(currentGame.intentHash);
        elements.currentPot.textContent = `${formatEth(game.wager.mul(2))} ETH`;
        elements.currentStatus.textContent = GameStatusNames[game.status];
        
        // Time left
        if (game.status === GameStatus.BothCommitted || game.status === GameStatus.Revealed) {
            const now = Math.floor(Date.now() / 1000);
            const timeLeft = game.revealDeadline - now;
            if (timeLeft > 0) {
                const mins = Math.floor(timeLeft / 60);
                const secs = timeLeft % 60;
                elements.timeLeft.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
            } else {
                elements.timeLeft.textContent = 'EXPIRED';
            }
        } else {
            elements.timeLeft.textContent = '--:--';
        }
        
        // Your side
        const yourCommitted = isPlayer1 ? game.player1Committed : game.player2Committed;
        const yourMove = isPlayer1 ? game.player1Move : game.player2Move;
        
        if (yourMove > 0) {
            elements.yourMoveDisplay.textContent = MoveEmoji[yourMove];
            elements.yourStatus.textContent = 'REVEALED';
            elements.yourStatus.className = 'status-label revealed';
        } else if (yourCommitted) {
            elements.yourMoveDisplay.textContent = '🔒';
            elements.yourStatus.textContent = 'COMMITTED';
            elements.yourStatus.className = 'status-label committed';
        } else {
            elements.yourMoveDisplay.textContent = '?';
            elements.yourStatus.textContent = 'WAITING';
            elements.yourStatus.className = 'status-label';
        }
        
        // Opponent side
        const oppCommitted = isPlayer1 ? game.player2Committed : game.player1Committed;
        const oppMove = isPlayer1 ? game.player2Move : game.player1Move;
        
        if (oppMove > 0) {
            elements.opponentMoveDisplay.textContent = MoveEmoji[oppMove];
            elements.opponentStatus.textContent = 'REVEALED';
            elements.opponentStatus.className = 'status-label revealed';
        } else if (oppCommitted) {
            elements.opponentMoveDisplay.textContent = '🔒';
            elements.opponentStatus.textContent = 'COMMITTED';
            elements.opponentStatus.className = 'status-label committed';
        } else {
            elements.opponentMoveDisplay.textContent = '?';
            elements.opponentStatus.textContent = 'WAITING';
            elements.opponentStatus.className = 'status-label';
        }
        
        // Show reveal button if both committed and we haven't revealed
        if (game.status === GameStatus.BothCommitted && yourMove === 0 && currentGame.salt) {
            elements.revealBtn.style.display = 'inline-block';
        } else {
            elements.revealBtn.style.display = 'none';
        }
        
        // Check for completed game
        if (game.status === GameStatus.Completed) {
            debugLog(`Game completed! Result: ${['Pending', 'P1 Wins', 'P2 Wins', 'Draw'][game.result]}`, 'success');
            showResult(game);
        }
        
    } catch (error) {
        console.error('Refresh error:', error);
        debugLog(`Refresh error: ${error.message}`, 'error');
        showToast('Failed to refresh game', 'error');
    }
}

async function revealMove() {
    if (!currentGame.intentHash || !currentGame.salt) {
        showToast('No move to reveal', 'error');
        return;
    }
    
    debugLog(`Revealing move: ${MoveNames[currentGame.move]}`, 'info');
    
    try {
        showLoading('REVEALING...');
        
        const tx = await contract.revealMove(
            currentGame.intentHash,
            currentGame.move,
            currentGame.salt
        );
        
        debugLog(`Reveal TX submitted: ${tx.hash}`, 'info');
        updateDebugLastTx(tx.hash);
        
        showLoading('CONFIRMING...');
        const receipt = await tx.wait();
        
        debugLog(`Move revealed in block ${receipt.blockNumber}`, 'success');
        
        showToast('Move revealed!', 'success');
        await refreshGameState();
        
    } catch (error) {
        console.error('Reveal error:', error);
        debugLog(`Reveal error: ${error.reason || error.message}`, 'error');
        showToast(error.reason || 'Failed to reveal', 'error');
    } finally {
        hideLoading();
    }
}

function showResult(game) {
    const isPlayer1 = currentGame.isPlayer1;
    const yourMove = isPlayer1 ? game.player1Move : game.player2Move;
    const oppMove = isPlayer1 ? game.player2Move : game.player1Move;
    
    elements.resultMove1.textContent = MoveEmoji[yourMove];
    elements.resultMove2.textContent = MoveEmoji[oppMove];
    
    const result = game.result;
    const yourResult = isPlayer1 
        ? (result === Result.Player1Wins ? 'win' : result === Result.Player2Wins ? 'lose' : 'draw')
        : (result === Result.Player2Wins ? 'win' : result === Result.Player1Wins ? 'lose' : 'draw');
    
    if (yourResult === 'win') {
        elements.resultTitle.textContent = 'YOU WIN!';
        elements.resultTitle.className = 'result-title winner';
        elements.resultPrize.textContent = `+${formatEth(game.wager)} ETH`;
        elements.resultPrize.className = 'result-prize';
    } else if (yourResult === 'lose') {
        elements.resultTitle.textContent = 'YOU LOSE';
        elements.resultTitle.className = 'result-title loser';
        elements.resultPrize.textContent = `-${formatEth(game.wager)} ETH`;
        elements.resultPrize.className = 'result-prize loss';
    } else {
        elements.resultTitle.textContent = 'DRAW!';
        elements.resultTitle.className = 'result-title draw';
        elements.resultPrize.textContent = 'REFUNDED';
        elements.resultPrize.className = 'result-prize';
    }
    
    showScreen('resultScreen');
}

async function loadMyGames() {
    try {
        showLoading('LOADING GAMES...');
        
        const gameIds = await contract.getPlayerGames(userAddress);
        
        if (gameIds.length === 0) {
            elements.gamesList.innerHTML = '<div class="empty-state">NO GAMES YET</div>';
            return;
        }
        
        elements.gamesList.innerHTML = '';
        
        // Load last 10 games
        const recentGames = gameIds.slice(-10).reverse();
        
        for (const gameId of recentGames) {
            const game = await contract.getGame(gameId);
            
            const isPlayer1 = game.player1.toLowerCase() === userAddress.toLowerCase();
            const opponent = isPlayer1 ? game.player2 : game.player1;
            
            const item = document.createElement('div');
            item.className = 'game-item';
            item.innerHTML = `
                <div class="game-item-info">
                    <div class="game-item-id">${shortenAddress(gameId)}</div>
                    <div class="game-item-opponent">vs ${shortenAddress(opponent)}</div>
                    <div class="game-item-wager">${formatEth(game.wager)} ETH</div>
                </div>
                <div class="game-item-status ${GameStatusNames[game.status].toLowerCase()}">
                    ${GameStatusNames[game.status]}
                </div>
            `;
            
            item.addEventListener('click', () => {
                loadGameScreen(gameId);
            });
            
            elements.gamesList.appendChild(item);
        }
        
    } catch (error) {
        console.error('Load games error:', error);
        showToast('Failed to load games', 'error');
    } finally {
        hideLoading();
    }
}

// ============================================
// Event Listeners
// ============================================

function setupEventListeners() {
    // Connect
    elements.connectBtn.addEventListener('click', connectWallet);
    
    // Lobby navigation
    elements.newGameBtn.addEventListener('click', () => showScreen('newGameScreen'));
    elements.joinGameBtn.addEventListener('click', () => showScreen('joinGameScreen'));
    elements.myGamesBtn.addEventListener('click', () => {
        showScreen('myGamesScreen');
        loadMyGames();
    });
    
    // Back buttons
    elements.backToLobbyBtn.addEventListener('click', () => showScreen('lobbyScreen'));
    elements.backFromJoinBtn.addEventListener('click', () => {
        elements.gamePreview.style.display = 'none';
        elements.joinMoveSelection.style.display = 'none';
        elements.acceptGameBtn.style.display = 'none';
        showScreen('lobbyScreen');
    });
    elements.backFromGameBtn.addEventListener('click', () => showScreen('lobbyScreen'));
    elements.backFromGamesBtn.addEventListener('click', () => showScreen('lobbyScreen'));
    
    // Wager buttons
    document.querySelectorAll('.wager-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.wager-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            elements.wagerAmount.value = btn.dataset.amount;
        });
    });
    
    // Move selection
    document.querySelectorAll('.move-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const parent = btn.closest('.form-group') || btn.closest('.form-container');
            parent.querySelectorAll('.move-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });
    
    // Game actions
    elements.createGameBtn.addEventListener('click', createGame);
    elements.loadGameBtn.addEventListener('click', loadGamePreview);
    elements.acceptGameBtn.addEventListener('click', acceptGame);
    elements.revealBtn.addEventListener('click', revealMove);
    elements.refreshGameBtn.addEventListener('click', refreshGameState);
    elements.refreshGamesBtn.addEventListener('click', loadMyGames);
    
    // Play again
    elements.playAgainBtn.addEventListener('click', () => {
        currentGame = { intentHash: null, move: null, salt: null, isPlayer1: false };
        updateDebugCurrentGame();
        updateDebugGameState(null);
        showScreen('lobbyScreen');
    });
    
    // Debug panel toggle
    elements.debugToggle.addEventListener('click', () => {
        const content = elements.debugContent;
        const isCollapsed = content.classList.toggle('collapsed');
        elements.debugToggle.textContent = isCollapsed ? '+' : '−';
    });
    
    // Copy on click for debug values
    document.querySelectorAll('.debug-value.copyable').forEach(el => {
        el.addEventListener('click', () => {
            const text = el.textContent;
            if (text && text !== '---') {
                copyToClipboard(text, el);
            }
        });
    });
    
    // Auto-refresh game state
    setInterval(() => {
        if (document.getElementById('gameScreen').classList.contains('active')) {
            refreshGameState();
        }
    }, 10000);
}

// ============================================
// Initialization
// ============================================

function init() {
    setupEventListeners();
    
    // Check if already connected
    if (window.ethereum && window.ethereum.selectedAddress) {
        connectWallet();
    }
    
    // Update contract address display
    elements.contractAddress.textContent = shortenAddress(CONFIG.CONTRACT_ADDRESS);
}

document.addEventListener('DOMContentLoaded', init);
