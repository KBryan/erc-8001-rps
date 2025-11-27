// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title RockPaperScissorsERC8001
 * @author ERC-8001 Reference Implementation
 * @notice Two-player Rock Paper Scissors using ERC-8001 Agent Coordination Framework
 * @dev Players commit moves via acceptances, then reveal to determine winner
 */
contract RockPaperScissorsERC8001 {
    // ============ Enums ============

    enum Move {
        None,
        Rock,
        Paper,
        Scissors
    }

    enum GameStatus {
        None,
        Proposed,
        BothCommitted,
        Revealed,
        Completed,
        Cancelled
    }

    enum Result {
        Pending,
        Player1Wins,
        Player2Wins,
        Draw
    }

    // ============ ERC-8001 Structures ============

    struct AgentIntent {
        bytes32 payloadHash;
        uint64 expiry;
        uint64 nonce;
        address agentId;
        bytes32 coordinationType;
        uint256 coordinationValue;
        address[] participants;
    }

    struct AcceptanceAttestation {
        bytes32 intentHash;
        address participant;
        uint64 nonce;
        uint64 expiry;
        bytes32 conditionsHash;
        bytes signature;
    }

    struct Game {
        address player1;
        address player2;
        uint256 wager;
        uint64 expiry;
        uint64 revealDeadline;
        GameStatus status;
        bytes32 player1Commitment;
        bytes32 player2Commitment;
        Move player1Move;
        Move player2Move;
        Result result;
    }

    // ============ Constants ============

    bytes32 public constant AGENT_INTENT_TYPEHASH = keccak256(
        "AgentIntent(bytes32 payloadHash,uint64 expiry,uint64 nonce,address agentId,bytes32 coordinationType,uint256 coordinationValue,address[] participants)"
    );

    bytes32 public constant ACCEPTANCE_TYPEHASH = keccak256(
        "AcceptanceAttestation(bytes32 intentHash,address participant,uint64 nonce,uint64 expiry,bytes32 conditionsHash)"
    );

    bytes32 public constant COORDINATION_TYPE = keccak256("RPS_GAME_V1");

    uint64 public constant REVEAL_WINDOW = 1 hours;

    // ============ EIP-712 ============

    bytes32 private constant TYPE_HASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 private immutable _cachedDomainSeparator;
    uint256 private immutable _cachedChainId;
    address private immutable _cachedThis;

    bytes32 private immutable _hashedName;
    bytes32 private immutable _hashedVersion;

    // ============ State ============

    mapping(bytes32 => Game) public games;
    mapping(address => uint64) public agentNonces;
    mapping(address => bytes32[]) public playerGames;

    // ============ Events ============

    event CoordinationProposed(
        bytes32 indexed intentHash, address indexed agentId, address indexed opponent, uint256 wager, uint64 expiry
    );

    event CoordinationAccepted(bytes32 indexed intentHash, address indexed participant, bytes32 commitment);

    event CoordinationExecuted(bytes32 indexed intentHash, Result result, address winner);

    event CoordinationCancelled(bytes32 indexed intentHash, address cancelledBy);

    event MoveRevealed(bytes32 indexed intentHash, address indexed player, Move move);

    // ============ Errors ============

    error InvalidSignature();
    error InvalidNonce();
    error IntentExpired();
    error ParticipantsNotCanonical();
    error NotParticipant();
    error AlreadyCommitted();
    error NotBothCommitted();
    error InvalidReveal();
    error RevealDeadlineExpired();
    error GameNotActive();
    error InsufficientWager();
    error InvalidCoordinationType();
    error InvalidParticipantCount();
    error CannotCancel();
    error TransferFailed();

    // ============ Constructor ============

    constructor() {
        _hashedName = keccak256(bytes("RockPaperScissorsERC8001"));
        _hashedVersion = keccak256(bytes("1"));

        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
        _cachedThis = address(this);
    }

    // ============ External Functions ============

    /**
     * @notice Propose a new game (ERC-8001 proposeCoordination)
     * @param intent The game challenge with wager and participants
     * @param signature EIP-712 signature from player1 (agentId)
     * @return intentHash The unique game identifier
     */
    function proposeCoordination(AgentIntent calldata intent, bytes calldata signature)
        external
        payable
        returns (bytes32 intentHash)
    {
        // Validate intent
        if (intent.expiry <= block.timestamp) revert IntentExpired();
        if (intent.nonce <= agentNonces[intent.agentId]) revert InvalidNonce();
        if (intent.coordinationType != COORDINATION_TYPE) revert InvalidCoordinationType();
        if (intent.participants.length != 2) revert InvalidParticipantCount();

        // ERC-8001: participants MUST be unique and strictly ascending
        if (uint160(intent.participants[0]) >= uint160(intent.participants[1])) {
            revert ParticipantsNotCanonical();
        }

        if (msg.value < intent.coordinationValue) revert InsufficientWager();

        // Verify EIP-712 signature
        intentHash = _getIntentHash(intent);
        bytes32 digest = _hashTypedDataV4(_getIntentStructHash(intent));
        address signer = _recoverSigner(digest, signature);
        if (signer != intent.agentId) revert InvalidSignature();

        // Update nonce (ERC-8001: MUST be monotonic)
        agentNonces[intent.agentId] = intent.nonce;

        // Determine player roles
        address player2 = intent.participants[0] == intent.agentId ? intent.participants[1] : intent.participants[0];

        // Store game state
        Game storage game = games[intentHash];
        game.player1 = intent.agentId;
        game.player2 = player2;
        game.wager = intent.coordinationValue;
        game.expiry = intent.expiry;
        game.status = GameStatus.Proposed;

        // Track games per player
        playerGames[intent.agentId].push(intentHash);
        playerGames[player2].push(intentHash);

        emit CoordinationProposed(intentHash, intent.agentId, player2, intent.coordinationValue, intent.expiry);
    }

    /**
     * @notice Accept game and commit move (ERC-8001 acceptCoordination)
     * @param acceptance Contains the move commitment in conditionsHash
     * @return allAccepted True if both players have committed
     * @dev conditionsHash = keccak256(abi.encodePacked(uint8(move), bytes32(salt)))
     */
    function acceptCoordination(AcceptanceAttestation calldata acceptance)
        external
        payable
        returns (bool allAccepted)
    {
        Game storage game = games[acceptance.intentHash];

        if (game.status == GameStatus.None) revert GameNotActive();
        if (game.status != GameStatus.Proposed) {
            // Only allow if waiting for second commitment
            if (
                !(game.status == GameStatus.Proposed
                    || (game.player1Commitment != bytes32(0) && game.player2Commitment == bytes32(0))
                    || (game.player2Commitment != bytes32(0) && game.player1Commitment == bytes32(0)))
            ) {
                revert GameNotActive();
            }
        }
        if (block.timestamp >= game.expiry) revert IntentExpired();
        if (acceptance.expiry <= block.timestamp) revert IntentExpired();

        // Verify participant
        bool isPlayer1 = acceptance.participant == game.player1;
        bool isPlayer2 = acceptance.participant == game.player2;
        if (!isPlayer1 && !isPlayer2) revert NotParticipant();

        // Check not already committed
        if (isPlayer1 && game.player1Commitment != bytes32(0)) revert AlreadyCommitted();
        if (isPlayer2 && game.player2Commitment != bytes32(0)) revert AlreadyCommitted();

        // Verify EIP-712 signature
        bytes32 digest = _hashTypedDataV4(_getAcceptanceStructHash(acceptance));
        address signer = _recoverSigner(digest, acceptance.signature);
        if (signer != acceptance.participant) revert InvalidSignature();

        // Player2 must match wager when accepting
        if (isPlayer2 && msg.value < game.wager) revert InsufficientWager();

        // Store commitment
        if (isPlayer1) {
            game.player1Commitment = acceptance.conditionsHash;
        } else {
            game.player2Commitment = acceptance.conditionsHash;
        }

        emit CoordinationAccepted(acceptance.intentHash, acceptance.participant, acceptance.conditionsHash);

        // Check if both committed (ERC-8001: Ready state)
        if (game.player1Commitment != bytes32(0) && game.player2Commitment != bytes32(0)) {
            game.status = GameStatus.BothCommitted;
            game.revealDeadline = uint64(block.timestamp) + REVEAL_WINDOW;
            return true;
        }

        return false;
    }

    /**
     * @notice Reveal your move
     * @param intentHash The game identifier
     * @param move Your move (1=Rock, 2=Paper, 3=Scissors)
     * @param salt Random salt used in commitment
     */
    function revealMove(bytes32 intentHash, Move move, bytes32 salt) external {
        Game storage game = games[intentHash];

        if (game.status != GameStatus.BothCommitted && game.status != GameStatus.Revealed) {
            revert NotBothCommitted();
        }
        if (block.timestamp > game.revealDeadline) revert RevealDeadlineExpired();
        if (move == Move.None) revert InvalidReveal();

        bytes32 commitment = keccak256(abi.encodePacked(uint8(move), salt));

        if (msg.sender == game.player1) {
            if (commitment != game.player1Commitment) revert InvalidReveal();
            game.player1Move = move;
        } else if (msg.sender == game.player2) {
            if (commitment != game.player2Commitment) revert InvalidReveal();
            game.player2Move = move;
        } else {
            revert NotParticipant();
        }

        emit MoveRevealed(intentHash, msg.sender, move);

        // Update status if first reveal
        if (game.status == GameStatus.BothCommitted) {
            game.status = GameStatus.Revealed;
        }

        // Auto-execute if both revealed
        if (game.player1Move != Move.None && game.player2Move != Move.None) {
            _executeGame(intentHash);
        }
    }

    /**
     * @notice Cancel game (ERC-8001 cancelCoordination)
     * @param intentHash The game identifier
     */
    function cancelCoordination(bytes32 intentHash) external {
        Game storage game = games[intentHash];

        if (game.status == GameStatus.None || game.status == GameStatus.Completed) {
            revert CannotCancel();
        }

        bool canCancel = false;
        address winner = address(0);
        uint256 player1Refund = 0;
        uint256 player2Refund = 0;

        // Proposer can cancel before opponent commits
        if (msg.sender == game.player1 && game.player2Commitment == bytes32(0)) {
            canCancel = true;
            player1Refund = game.wager;
        }
        // Anyone can cancel after expiry if not both committed
        else if (block.timestamp > game.expiry && game.status == GameStatus.Proposed) {
            canCancel = true;
            player1Refund = game.wager;
        }
        // Handle reveal deadline timeout
        else if (block.timestamp > game.revealDeadline && game.status != GameStatus.Completed) {
            canCancel = true;

            if (game.player1Move == Move.None && game.player2Move != Move.None) {
                // Player1 didn't reveal - player2 wins by forfeit
                winner = game.player2;
                player2Refund = game.wager * 2;
            } else if (game.player2Move == Move.None && game.player1Move != Move.None) {
                // Player2 didn't reveal - player1 wins by forfeit
                winner = game.player1;
                player1Refund = game.wager * 2;
            } else {
                // Neither revealed - refund both
                player1Refund = game.wager;
                player2Refund = game.wager;
            }
        }

        if (!canCancel) revert CannotCancel();

        game.status = GameStatus.Cancelled;

        // Process refunds
        if (player1Refund > 0) {
            _safeTransfer(game.player1, player1Refund);
        }
        if (player2Refund > 0) {
            _safeTransfer(game.player2, player2Refund);
        }

        emit CoordinationCancelled(intentHash, msg.sender);

        if (winner != address(0)) {
            emit CoordinationExecuted(
                intentHash, winner == game.player1 ? Result.Player1Wins : Result.Player2Wins, winner
            );
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get game status (ERC-8001 getCoordinationStatus)
     */
    function getCoordinationStatus(bytes32 intentHash) external view returns (GameStatus) {
        return games[intentHash].status;
    }

    /**
     * @notice Get full game details
     */
    function getGame(bytes32 intentHash)
        external
        view
        returns (
            address player1,
            address player2,
            uint256 wager,
            uint64 expiry,
            uint64 revealDeadline,
            GameStatus status,
            bool player1Committed,
            bool player2Committed,
            Move player1Move,
            Move player2Move,
            Result result
        )
    {
        Game storage game = games[intentHash];
        return (
            game.player1,
            game.player2,
            game.wager,
            game.expiry,
            game.revealDeadline,
            game.status,
            game.player1Commitment != bytes32(0),
            game.player2Commitment != bytes32(0),
            game.player1Move,
            game.player2Move,
            game.result
        );
    }

    /**
     * @notice Get games for a player
     */
    function getPlayerGames(address player) external view returns (bytes32[] memory) {
        return playerGames[player];
    }

    /**
     * @notice Get EIP-712 domain separator
     */
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @notice ERC-5267: EIP-712 domain info
     */
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        )
    {
        return (
            hex"0f", // 01111
            "RockPaperScissorsERC8001",
            "1",
            block.chainid,
            address(this),
            bytes32(0),
            new uint256[](0)
        );
    }

    // ============ Internal Functions ============

    function _executeGame(bytes32 intentHash) internal {
        Game storage game = games[intentHash];

        game.result = _determineWinner(game.player1Move, game.player2Move);
        game.status = GameStatus.Completed;

        uint256 totalPot = game.wager * 2;
        address winner;

        if (game.result == Result.Player1Wins) {
            winner = game.player1;
            _safeTransfer(game.player1, totalPot);
        } else if (game.result == Result.Player2Wins) {
            winner = game.player2;
            _safeTransfer(game.player2, totalPot);
        } else {
            // Draw - refund both
            _safeTransfer(game.player1, game.wager);
            _safeTransfer(game.player2, game.wager);
        }

        emit CoordinationExecuted(intentHash, game.result, winner);
    }

    function _determineWinner(Move p1, Move p2) internal pure returns (Result) {
        if (p1 == p2) return Result.Draw;

        if (
            (p1 == Move.Rock && p2 == Move.Scissors) || (p1 == Move.Paper && p2 == Move.Rock)
                || (p1 == Move.Scissors && p2 == Move.Paper)
        ) {
            return Result.Player1Wins;
        }

        return Result.Player2Wins;
    }

    function _safeTransfer(address to, uint256 amount) internal {
        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    // ============ EIP-712 Helpers ============

    function _domainSeparatorV4() internal view returns (bytes32) {
        if (address(this) == _cachedThis && block.chainid == _cachedChainId) {
            return _cachedDomainSeparator;
        } else {
            return _buildDomainSeparator();
        }
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(TYPE_HASH, _hashedName, _hashedVersion, block.chainid, address(this)));
    }

    function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparatorV4(), structHash));
    }

    function _getIntentStructHash(AgentIntent calldata i) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                AGENT_INTENT_TYPEHASH,
                i.payloadHash,
                i.expiry,
                i.nonce,
                i.agentId,
                i.coordinationType,
                i.coordinationValue,
                keccak256(abi.encodePacked(i.participants))
            )
        );
    }

    function _getIntentHash(AgentIntent calldata i) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                i.payloadHash,
                i.expiry,
                i.nonce,
                i.agentId,
                i.coordinationType,
                i.coordinationValue,
                keccak256(abi.encodePacked(i.participants))
            )
        );
    }

    function _getAcceptanceStructHash(AcceptanceAttestation calldata a) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(ACCEPTANCE_TYPEHASH, a.intentHash, a.participant, a.nonce, a.expiry, a.conditionsHash)
        );
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        // EIP-2: Ensure s is in lower half
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert InvalidSignature();
        }

        if (v != 27 && v != 28) revert InvalidSignature();

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();

        return signer;
    }

    // ============ Receive ============

    receive() external payable {}
}
