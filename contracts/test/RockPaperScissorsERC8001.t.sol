// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {RockPaperScissorsERC8001} from "../src/RockPaperScissorsERC8001.sol";

contract RockPaperScissorsERC8001Test is Test {
    RockPaperScissorsERC8001 public rps;

    address public player1;
    uint256 public player1Key;
    address public player2;
    uint256 public player2Key;
    address public player3;

    uint256 public constant WAGER = 0.1 ether;

    bytes32 public constant COORDINATION_TYPE = keccak256("RPS_GAME_V1");

    bytes32 constant AGENT_INTENT_TYPEHASH = keccak256(
        "AgentIntent(bytes32 payloadHash,uint64 expiry,uint64 nonce,address agentId,bytes32 coordinationType,uint256 coordinationValue,address[] participants)"
    );

    bytes32 constant ACCEPTANCE_TYPEHASH = keccak256(
        "AcceptanceAttestation(bytes32 intentHash,address participant,uint64 nonce,uint64 expiry,bytes32 conditionsHash)"
    );

    function setUp() public {
        rps = new RockPaperScissorsERC8001();

        (player1, player1Key) = makeAddrAndKey("player1");
        (player2, player2Key) = makeAddrAndKey("player2");
        player3 = makeAddr("player3");

        vm.deal(player1, 10 ether);
        vm.deal(player2, 10 ether);
        vm.deal(player3, 10 ether);
    }

    // ============ Helper Functions ============

    function _getDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("RockPaperScissorsERC8001")),
                keccak256(bytes("1")),
                block.chainid,
                address(rps)
            )
        );
    }

    function _createIntent(address agentId, address opponent, uint64 expiry, uint64 nonce, uint256 wager)
        internal
        pure
        returns (RockPaperScissorsERC8001.AgentIntent memory)
    {
        address[] memory participants = new address[](2);
        if (uint160(agentId) < uint160(opponent)) {
            participants[0] = agentId;
            participants[1] = opponent;
        } else {
            participants[0] = opponent;
            participants[1] = agentId;
        }

        return RockPaperScissorsERC8001.AgentIntent({
            payloadHash: bytes32(0),
            expiry: expiry,
            nonce: nonce,
            agentId: agentId,
            coordinationType: COORDINATION_TYPE,
            coordinationValue: wager,
            participants: participants
        });
    }

    function _signIntent(RockPaperScissorsERC8001.AgentIntent memory intent, uint256 privateKey)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                AGENT_INTENT_TYPEHASH,
                intent.payloadHash,
                intent.expiry,
                intent.nonce,
                intent.agentId,
                intent.coordinationType,
                intent.coordinationValue,
                keccak256(abi.encodePacked(intent.participants))
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _getDomainSeparator(), structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _createCommitment(RockPaperScissorsERC8001.Move move, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(uint8(move), salt));
    }

    function _signAcceptance(
        bytes32 intentHash,
        address participant,
        uint64 nonce,
        uint64 expiry,
        bytes32 conditionsHash,
        uint256 privateKey
    ) internal view returns (bytes memory) {
        bytes32 structHash =
            keccak256(abi.encode(ACCEPTANCE_TYPEHASH, intentHash, participant, nonce, expiry, conditionsHash));

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _getDomainSeparator(), structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _getIntentHash(RockPaperScissorsERC8001.AgentIntent memory i) internal pure returns (bytes32) {
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

    // ============ Propose Tests ============

    function test_ProposeGame() public {
        RockPaperScissorsERC8001.AgentIntent memory intent =
            _createIntent(player1, player2, uint64(block.timestamp + 1 hours), 1, WAGER);

        bytes memory signature = _signIntent(intent, player1Key);

        vm.prank(player1);
        bytes32 intentHash = rps.proposeCoordination{value: WAGER}(intent, signature);

        assertEq(uint8(rps.getCoordinationStatus(intentHash)), uint8(RockPaperScissorsERC8001.GameStatus.Proposed));

        (address p1, address p2, uint256 wager,,, RockPaperScissorsERC8001.GameStatus status,,,,,) =
            rps.getGame(intentHash);

        assertEq(p1, player1);
        assertEq(p2, player2);
        assertEq(wager, WAGER);
        assertEq(uint8(status), uint8(RockPaperScissorsERC8001.GameStatus.Proposed));
    }

    function test_ProposeGame_RevertInvalidNonce() public {
        RockPaperScissorsERC8001.AgentIntent memory intent =
            _createIntent(player1, player2, uint64(block.timestamp + 1 hours), 1, WAGER);

        bytes memory signature = _signIntent(intent, player1Key);

        vm.prank(player1);
        rps.proposeCoordination{value: WAGER}(intent, signature);

        // Try same nonce again
        intent = _createIntent(player1, player2, uint64(block.timestamp + 1 hours), 1, WAGER);
        signature = _signIntent(intent, player1Key);

        vm.expectRevert(RockPaperScissorsERC8001.InvalidNonce.selector);
        vm.prank(player1);
        rps.proposeCoordination{value: WAGER}(intent, signature);
    }

    function test_ProposeGame_RevertExpired() public {
        RockPaperScissorsERC8001.AgentIntent memory intent =
            _createIntent(player1, player2, uint64(block.timestamp - 1), 1, WAGER);

        bytes memory signature = _signIntent(intent, player1Key);

        vm.expectRevert(RockPaperScissorsERC8001.IntentExpired.selector);
        vm.prank(player1);
        rps.proposeCoordination{value: WAGER}(intent, signature);
    }

    function test_ProposeGame_RevertInsufficientWager() public {
        RockPaperScissorsERC8001.AgentIntent memory intent =
            _createIntent(player1, player2, uint64(block.timestamp + 1 hours), 1, WAGER);

        bytes memory signature = _signIntent(intent, player1Key);

        vm.expectRevert(RockPaperScissorsERC8001.InsufficientWager.selector);
        vm.prank(player1);
        rps.proposeCoordination{value: WAGER - 1}(intent, signature);
    }

    function test_ProposeGame_RevertNonCanonicalParticipants() public {
        address[] memory participants = new address[](2);
        // Wrong order (descending instead of ascending)
        participants[0] = address(0xBBBB);
        participants[1] = address(0xAAAA);

        RockPaperScissorsERC8001.AgentIntent memory intent = RockPaperScissorsERC8001.AgentIntent({
            payloadHash: bytes32(0),
            expiry: uint64(block.timestamp + 1 hours),
            nonce: 1,
            agentId: player1,
            coordinationType: COORDINATION_TYPE,
            coordinationValue: WAGER,
            participants: participants
        });

        bytes memory signature = _signIntent(intent, player1Key);

        vm.expectRevert(RockPaperScissorsERC8001.ParticipantsNotCanonical.selector);
        vm.prank(player1);
        rps.proposeCoordination{value: WAGER}(intent, signature);
    }

    // ============ Accept Tests ============

    function test_AcceptGame() public {
        // Propose
        RockPaperScissorsERC8001.AgentIntent memory intent =
            _createIntent(player1, player2, uint64(block.timestamp + 1 hours), 1, WAGER);

        bytes memory signature = _signIntent(intent, player1Key);

        vm.prank(player1);
        bytes32 intentHash = rps.proposeCoordination{value: WAGER}(intent, signature);

        // Player1 commits
        bytes32 salt1 = keccak256("player1salt");
        bytes32 commitment1 = _createCommitment(RockPaperScissorsERC8001.Move.Rock, salt1);

        bytes memory acceptSig1 = _signAcceptance(
            intentHash, player1, 1, uint64(block.timestamp + 1 hours), commitment1, player1Key
        );

        RockPaperScissorsERC8001.AcceptanceAttestation memory acceptance1 = RockPaperScissorsERC8001
            .AcceptanceAttestation({
            intentHash: intentHash,
            participant: player1,
            nonce: 1,
            expiry: uint64(block.timestamp + 1 hours),
            conditionsHash: commitment1,
            signature: acceptSig1
        });

        vm.prank(player1);
        bool allAccepted = rps.acceptCoordination(acceptance1);
        assertFalse(allAccepted);

        // Player2 commits
        bytes32 salt2 = keccak256("player2salt");
        bytes32 commitment2 = _createCommitment(RockPaperScissorsERC8001.Move.Paper, salt2);

        bytes memory acceptSig2 = _signAcceptance(
            intentHash, player2, 1, uint64(block.timestamp + 1 hours), commitment2, player2Key
        );

        RockPaperScissorsERC8001.AcceptanceAttestation memory acceptance2 = RockPaperScissorsERC8001
            .AcceptanceAttestation({
            intentHash: intentHash,
            participant: player2,
            nonce: 1,
            expiry: uint64(block.timestamp + 1 hours),
            conditionsHash: commitment2,
            signature: acceptSig2
        });

        vm.prank(player2);
        allAccepted = rps.acceptCoordination{value: WAGER}(acceptance2);
        assertTrue(allAccepted);

        assertEq(
            uint8(rps.getCoordinationStatus(intentHash)), uint8(RockPaperScissorsERC8001.GameStatus.BothCommitted)
        );
    }

    // ============ Reveal & Execute Tests ============

    function test_FullGame_Player1Wins() public {
        // Setup: Rock beats Scissors
        _playFullGame(RockPaperScissorsERC8001.Move.Rock, RockPaperScissorsERC8001.Move.Scissors);

        bytes32 intentHash = rps.getPlayerGames(player1)[0];
        (,,,,,,,,, RockPaperScissorsERC8001.Move p1Move, RockPaperScissorsERC8001.Move p2Move, RockPaperScissorsERC8001.Result result) =
            rps.getGame(intentHash);

        assertEq(uint8(p1Move), uint8(RockPaperScissorsERC8001.Move.Rock));
        assertEq(uint8(p2Move), uint8(RockPaperScissorsERC8001.Move.Scissors));
        assertEq(uint8(result), uint8(RockPaperScissorsERC8001.Result.Player1Wins));
    }

    function test_FullGame_Player2Wins() public {
        _playFullGame(RockPaperScissorsERC8001.Move.Rock, RockPaperScissorsERC8001.Move.Paper);

        bytes32 intentHash = rps.getPlayerGames(player1)[0];
        (,,,,,,,,,, RockPaperScissorsERC8001.Result result) = rps.getGame(intentHash);

        assertEq(uint8(result), uint8(RockPaperScissorsERC8001.Result.Player2Wins));
    }

    function test_FullGame_Draw() public {
        uint256 p1BalanceBefore = player1.balance;
        uint256 p2BalanceBefore = player2.balance;

        _playFullGame(RockPaperScissorsERC8001.Move.Rock, RockPaperScissorsERC8001.Move.Rock);

        bytes32 intentHash = rps.getPlayerGames(player1)[0];
        (,,,,,,,,,, RockPaperScissorsERC8001.Result result) = rps.getGame(intentHash);

        assertEq(uint8(result), uint8(RockPaperScissorsERC8001.Result.Draw));

        // Both should get refunds
        assertEq(player1.balance, p1BalanceBefore);
        assertEq(player2.balance, p2BalanceBefore);
    }

    function test_FullGame_WinnerGetsFullPot() public {
        uint256 p1BalanceBefore = player1.balance;

        _playFullGame(RockPaperScissorsERC8001.Move.Scissors, RockPaperScissorsERC8001.Move.Paper);

        // Player1 wins, should have original balance + opponent's wager
        assertEq(player1.balance, p1BalanceBefore + WAGER);
    }

    // ============ Cancel Tests ============

    function test_CancelBeforeOpponentCommits() public {
        RockPaperScissorsERC8001.AgentIntent memory intent =
            _createIntent(player1, player2, uint64(block.timestamp + 1 hours), 1, WAGER);

        bytes memory signature = _signIntent(intent, player1Key);

        uint256 balanceBefore = player1.balance;

        vm.prank(player1);
        bytes32 intentHash = rps.proposeCoordination{value: WAGER}(intent, signature);

        vm.prank(player1);
        rps.cancelCoordination(intentHash);

        assertEq(uint8(rps.getCoordinationStatus(intentHash)), uint8(RockPaperScissorsERC8001.GameStatus.Cancelled));
        assertEq(player1.balance, balanceBefore);
    }

    function test_CancelAfterRevealDeadline_Player1Forfeit() public {
        bytes32 intentHash = _setupCommittedGame();

        // Only player2 reveals
        bytes32 salt2 = keccak256("player2salt");
        vm.prank(player2);
        rps.revealMove(intentHash, RockPaperScissorsERC8001.Move.Paper, salt2);

        // Fast forward past reveal deadline
        vm.warp(block.timestamp + 2 hours);

        uint256 p2BalanceBefore = player2.balance;

        vm.prank(player3);
        rps.cancelCoordination(intentHash);

        // Player2 wins by forfeit
        assertEq(player2.balance, p2BalanceBefore + WAGER * 2);
    }

    // ============ Edge Cases ============

    function test_RevealWithWrongSalt() public {
        bytes32 intentHash = _setupCommittedGame();

        vm.expectRevert(RockPaperScissorsERC8001.InvalidReveal.selector);
        vm.prank(player1);
        rps.revealMove(intentHash, RockPaperScissorsERC8001.Move.Rock, keccak256("wrongsalt"));
    }

    function test_RevealAfterDeadline() public {
        bytes32 intentHash = _setupCommittedGame();

        vm.warp(block.timestamp + 2 hours);

        vm.expectRevert(RockPaperScissorsERC8001.RevealDeadlineExpired.selector);
        vm.prank(player1);
        rps.revealMove(intentHash, RockPaperScissorsERC8001.Move.Rock, keccak256("player1salt"));
    }

    function test_NonParticipantCannotReveal() public {
        bytes32 intentHash = _setupCommittedGame();

        vm.expectRevert(RockPaperScissorsERC8001.NotParticipant.selector);
        vm.prank(player3);
        rps.revealMove(intentHash, RockPaperScissorsERC8001.Move.Rock, keccak256("salt"));
    }

    // ============ Fuzz Tests ============

    function testFuzz_GameOutcomes(uint8 move1Raw, uint8 move2Raw) public {
        // Bound moves to valid range (1-3)
        uint8 move1 = uint8(bound(move1Raw, 1, 3));
        uint8 move2 = uint8(bound(move2Raw, 1, 3));

        _playFullGame(RockPaperScissorsERC8001.Move(move1), RockPaperScissorsERC8001.Move(move2));

        bytes32 intentHash = rps.getPlayerGames(player1)[0];
        (,,,,,,,,,, RockPaperScissorsERC8001.Result result) = rps.getGame(intentHash);

        // Verify correct outcome
        if (move1 == move2) {
            assertEq(uint8(result), uint8(RockPaperScissorsERC8001.Result.Draw));
        } else if (
            (move1 == 1 && move2 == 3) || // Rock beats Scissors
            (move1 == 2 && move2 == 1) || // Paper beats Rock
            (move1 == 3 && move2 == 2) // Scissors beats Paper
        ) {
            assertEq(uint8(result), uint8(RockPaperScissorsERC8001.Result.Player1Wins));
        } else {
            assertEq(uint8(result), uint8(RockPaperScissorsERC8001.Result.Player2Wins));
        }
    }

    // ============ Helper Functions ============

    function _playFullGame(RockPaperScissorsERC8001.Move move1, RockPaperScissorsERC8001.Move move2) internal {
        // Propose
        RockPaperScissorsERC8001.AgentIntent memory intent =
            _createIntent(player1, player2, uint64(block.timestamp + 1 hours), 1, WAGER);

        bytes memory signature = _signIntent(intent, player1Key);

        vm.prank(player1);
        bytes32 intentHash = rps.proposeCoordination{value: WAGER}(intent, signature);

        // Commit
        bytes32 salt1 = keccak256("player1salt");
        bytes32 salt2 = keccak256("player2salt");

        bytes32 commitment1 = _createCommitment(move1, salt1);
        bytes32 commitment2 = _createCommitment(move2, salt2);

        bytes memory acceptSig1 = _signAcceptance(
            intentHash, player1, 1, uint64(block.timestamp + 1 hours), commitment1, player1Key
        );

        RockPaperScissorsERC8001.AcceptanceAttestation memory acceptance1 = RockPaperScissorsERC8001
            .AcceptanceAttestation({
            intentHash: intentHash,
            participant: player1,
            nonce: 1,
            expiry: uint64(block.timestamp + 1 hours),
            conditionsHash: commitment1,
            signature: acceptSig1
        });

        vm.prank(player1);
        rps.acceptCoordination(acceptance1);

        bytes memory acceptSig2 = _signAcceptance(
            intentHash, player2, 1, uint64(block.timestamp + 1 hours), commitment2, player2Key
        );

        RockPaperScissorsERC8001.AcceptanceAttestation memory acceptance2 = RockPaperScissorsERC8001
            .AcceptanceAttestation({
            intentHash: intentHash,
            participant: player2,
            nonce: 1,
            expiry: uint64(block.timestamp + 1 hours),
            conditionsHash: commitment2,
            signature: acceptSig2
        });

        vm.prank(player2);
        rps.acceptCoordination{value: WAGER}(acceptance2);

        // Reveal
        vm.prank(player1);
        rps.revealMove(intentHash, move1, salt1);

        vm.prank(player2);
        rps.revealMove(intentHash, move2, salt2);
    }

    function _setupCommittedGame() internal returns (bytes32 intentHash) {
        RockPaperScissorsERC8001.AgentIntent memory intent =
            _createIntent(player1, player2, uint64(block.timestamp + 1 hours), 1, WAGER);

        bytes memory signature = _signIntent(intent, player1Key);

        vm.prank(player1);
        intentHash = rps.proposeCoordination{value: WAGER}(intent, signature);

        bytes32 salt1 = keccak256("player1salt");
        bytes32 salt2 = keccak256("player2salt");

        bytes32 commitment1 = _createCommitment(RockPaperScissorsERC8001.Move.Rock, salt1);
        bytes32 commitment2 = _createCommitment(RockPaperScissorsERC8001.Move.Paper, salt2);

        bytes memory acceptSig1 = _signAcceptance(
            intentHash, player1, 1, uint64(block.timestamp + 1 hours), commitment1, player1Key
        );

        RockPaperScissorsERC8001.AcceptanceAttestation memory acceptance1 = RockPaperScissorsERC8001
            .AcceptanceAttestation({
            intentHash: intentHash,
            participant: player1,
            nonce: 1,
            expiry: uint64(block.timestamp + 1 hours),
            conditionsHash: commitment1,
            signature: acceptSig1
        });

        vm.prank(player1);
        rps.acceptCoordination(acceptance1);

        bytes memory acceptSig2 = _signAcceptance(
            intentHash, player2, 1, uint64(block.timestamp + 1 hours), commitment2, player2Key
        );

        RockPaperScissorsERC8001.AcceptanceAttestation memory acceptance2 = RockPaperScissorsERC8001
            .AcceptanceAttestation({
            intentHash: intentHash,
            participant: player2,
            nonce: 1,
            expiry: uint64(block.timestamp + 1 hours),
            conditionsHash: commitment2,
            signature: acceptSig2
        });

        vm.prank(player2);
        rps.acceptCoordination{value: WAGER}(acceptance2);
    }
}
