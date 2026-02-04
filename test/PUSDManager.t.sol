// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../src/PUSD.sol";
import "../src/PUSDManager.sol";

contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PUSDManagerTest is Test {
    PUSD public pusd;
    PUSDManager public manager;
    ERC1967Proxy public pusdProxy;
    ERC1967Proxy public managerProxy;

    MockERC20 public usdtEth;
    MockERC20 public usdcEth;
    MockERC20 public usdtSol;
    MockERC20 public usdcSol;
    MockERC20 public usdtBase;
    MockERC20 public usdcBase;
    MockERC20 public usdtArb;
    MockERC20 public usdcArb;
    MockERC20 public usdtBnb;

    address public admin = address(1);
    address public user = address(2);

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    function setUp() public {
        PUSD pusdImpl = new PUSD();
        bytes memory pusdInitData = abi.encodeWithSelector(PUSD.initialize.selector, admin);
        pusdProxy = new ERC1967Proxy(address(pusdImpl), pusdInitData);
        pusd = PUSD(address(pusdProxy));

        PUSDManager managerImpl = new PUSDManager();
        bytes memory managerInitData = abi.encodeWithSelector(
            PUSDManager.initialize.selector,
            address(pusd),
            admin
        );
        managerProxy = new ERC1967Proxy(address(managerImpl), managerInitData);
        manager = PUSDManager(address(managerProxy));

        vm.startPrank(admin);
        pusd.grantRole(MINTER_ROLE, address(manager));
        pusd.grantRole(BURNER_ROLE, address(manager));
        vm.stopPrank();

        usdtEth = new MockERC20("USDT.eth", "USDT.eth", 6);
        usdcEth = new MockERC20("USDC.eth", "USDC.eth", 6);
        usdtSol = new MockERC20("USDT.sol", "USDT.sol", 6);
        usdcSol = new MockERC20("USDC.sol", "USDC.sol", 6);
        usdtBase = new MockERC20("USDT.base", "USDT.base", 6);
        usdcBase = new MockERC20("USDC.base", "USDC.base", 6);
        usdtArb = new MockERC20("USDT.arb", "USDT.arb", 6);
        usdcArb = new MockERC20("USDC.arb", "USDC.arb", 6);
        usdtBnb = new MockERC20("USDT.bnb", "USDT.bnb", 18);
    }

    function testInitialization() public {
        assertEq(address(manager.pusd()), address(pusd));
        assertTrue(manager.hasRole(manager.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(manager.hasRole(manager.ADMIN_ROLE(), admin));
        assertTrue(manager.hasRole(manager.UPGRADER_ROLE(), admin));
    }

    function testAddSupportedToken() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        assertTrue(manager.isTokenSupported(address(usdtEth)));
        assertEq(manager.getSupportedTokensCount(), 1);
        assertEq(manager.getSupportedTokenAt(0), address(usdtEth));

        PUSDManager.TokenInfo memory info = manager.getTokenInfo(address(usdtEth));
        assertEq(uint256(info.status), uint256(PUSDManager.TokenStatus.ENABLED));
        assertEq(info.decimals, 6);
        assertEq(info.name, "USDT.eth");
        assertEq(info.chainNamespace, "Ethereum_Sepolia");
    }

    function testAddMultipleSupportedTokens() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdtSol), "USDT.sol", "Solana_Devnet", 6);
        manager.addSupportedToken(address(usdcSol), "USDC.sol", "Solana_Devnet", 6);
        manager.addSupportedToken(address(usdtBase), "USDT.base", "Base_Testnet", 6);
        manager.addSupportedToken(address(usdcBase), "USDC.base", "Base_Testnet", 6);
        manager.addSupportedToken(address(usdtArb), "USDT.arb", "Arbitrum_Sepolia", 6);
        manager.addSupportedToken(address(usdcArb), "USDC.arb", "Arbitrum_Sepolia", 6);
        manager.addSupportedToken(address(usdtBnb), "USDT.bnb", "BNB_Testnet", 18);
        vm.stopPrank();

        assertEq(manager.getSupportedTokensCount(), 9);
        assertTrue(manager.isTokenSupported(address(usdtEth)));
        assertTrue(manager.isTokenSupported(address(usdcEth)));
        assertTrue(manager.isTokenSupported(address(usdtSol)));
        assertTrue(manager.isTokenSupported(address(usdcSol)));
        assertTrue(manager.isTokenSupported(address(usdtBase)));
        assertTrue(manager.isTokenSupported(address(usdcBase)));
        assertTrue(manager.isTokenSupported(address(usdtArb)));
        assertTrue(manager.isTokenSupported(address(usdcArb)));
        assertTrue(manager.isTokenSupported(address(usdtBnb)));
    }

    function testAddSupportedTokenOnlyAdmin() public {
        vm.prank(user);
        vm.expectRevert();
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
    }

    function testAddSupportedTokenZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert("PUSDManager: token address cannot be zero");
        manager.addSupportedToken(address(0), "USDT.eth", "Ethereum_Sepolia", 6);
    }

    function testAddSupportedTokenAlreadySupported() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        
        vm.expectRevert("PUSDManager: token already added");
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        vm.stopPrank();
    }

    function testSetTokenStatusToRedeemOnly() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.setTokenStatus(address(usdtEth), PUSDManager.TokenStatus.REDEEM_ONLY);
        vm.stopPrank();

        assertEq(uint256(manager.getTokenStatus(address(usdtEth))), uint256(PUSDManager.TokenStatus.REDEEM_ONLY));
        assertTrue(manager.isTokenSupported(address(usdtEth)));
    }

    function testSetTokenStatusToRemoved() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.setTokenStatus(address(usdtEth), PUSDManager.TokenStatus.REMOVED);
        vm.stopPrank();

        assertEq(uint256(manager.getTokenStatus(address(usdtEth))), uint256(PUSDManager.TokenStatus.REMOVED));
        assertFalse(manager.isTokenSupported(address(usdtEth)));
    }

    function testSetTokenStatusNotAdded() public {
        vm.prank(admin);
        vm.expectRevert("PUSDManager: token not added");
        manager.setTokenStatus(address(usdtEth), PUSDManager.TokenStatus.REDEEM_ONLY);
    }

    function testSetTokenStatusUnchanged() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        vm.expectRevert("PUSDManager: status unchanged");
        manager.setTokenStatus(address(usdtEth), PUSDManager.TokenStatus.ENABLED);
        vm.stopPrank();
    }

    function testCannotReAddTokenAfterRemoving() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        
        assertEq(manager.getSupportedTokensCount(), 1);
        assertEq(manager.getSupportedTokenAt(0), address(usdtEth));
        
        manager.setTokenStatus(address(usdtEth), PUSDManager.TokenStatus.REMOVED);
        
        vm.expectRevert("PUSDManager: token already added");
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        
        assertEq(manager.getSupportedTokensCount(), 1, "Token count should remain 1");
        assertEq(manager.getSupportedTokenAt(0), address(usdtEth), "Token list should not be corrupted");
        vm.stopPrank();
    }

    function testDepositRedeemOnlyToken() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.setTokenStatus(address(usdtEth), PUSDManager.TokenStatus.REDEEM_ONLY);
        vm.stopPrank();

        uint256 depositAmount = 1000 * 10**6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        vm.expectRevert("PUSDManager: token not enabled for deposits");
        manager.deposit(address(usdtEth), depositAmount);
        vm.stopPrank();
    }

    function testDeposit() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount = 1000 * 10**6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount);
        vm.stopPrank();

        assertEq(pusd.balanceOf(user), depositAmount);
        assertEq(usdtEth.balanceOf(address(manager)), depositAmount);
        assertEq(usdtEth.balanceOf(user), 0);
    }

    function testDepositWithDifferentDecimals() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtBnb), "USDT.bnb", "BNB_Testnet", 18);

        uint256 depositAmount = 1000 * 10**18;
        usdtBnb.mint(user, depositAmount);

        vm.startPrank(user);
        usdtBnb.approve(address(manager), depositAmount);
        manager.deposit(address(usdtBnb), depositAmount);
        vm.stopPrank();

        uint256 expectedPUSD = 1000 * 10**6;
        assertEq(pusd.balanceOf(user), expectedPUSD);
        assertEq(usdtBnb.balanceOf(address(manager)), depositAmount);
    }

    function testDepositUnsupportedToken() public {
        uint256 depositAmount = 1000 * 10**6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        vm.expectRevert("PUSDManager: token not enabled for deposits");
        manager.deposit(address(usdtEth), depositAmount);
        vm.stopPrank();
    }

    function testDepositZeroAmount() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        vm.prank(user);
        vm.expectRevert("PUSDManager: amount must be greater than 0");
        manager.deposit(address(usdtEth), 0);
    }

    function testRedeem() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount = 1000 * 10**6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount);

        uint256 redeemAmount = 500 * 10**6;
        manager.redeem(redeemAmount, address(usdtEth), false);
        vm.stopPrank();

        assertEq(pusd.balanceOf(user), 500 * 10**6);
        assertEq(usdtEth.balanceOf(user), 500 * 10**6);
        assertEq(usdtEth.balanceOf(address(manager)), 500 * 10**6);
    }

    function testRedeemWithDifferentDecimals() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtBnb), "USDT.bnb", "BNB_Testnet", 18);

        uint256 depositAmount = 1000 * 10**18;
        usdtBnb.mint(user, depositAmount);

        vm.startPrank(user);
        usdtBnb.approve(address(manager), depositAmount);
        manager.deposit(address(usdtBnb), depositAmount);

        uint256 redeemPUSD = 500 * 10**6;
        manager.redeem(redeemPUSD, address(usdtBnb), false);
        vm.stopPrank();

        assertEq(pusd.balanceOf(user), 500 * 10**6);
        assertEq(usdtBnb.balanceOf(user), 500 * 10**18);
        assertEq(usdtBnb.balanceOf(address(manager)), 500 * 10**18);
    }

    function testRedeemUnsupportedToken() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        
        uint256 depositAmount = 100 * 10**6;
        usdcEth.mint(user, depositAmount);
        
        vm.startPrank(user);
        usdcEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdcEth), depositAmount);
        
        vm.expectRevert("PUSDManager: preferred asset unavailable and basket not allowed");
        manager.redeem(100 * 10**6, address(usdtEth), false);
        vm.stopPrank();
    }

    function testRedeemInsufficientPUSD() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        vm.prank(user);
        vm.expectRevert("PUSDManager: insufficient PUSD balance");
        manager.redeem(100 * 10**6, address(usdtEth), false);
    }

    function testRedeemInsufficientLiquidity() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        vm.stopPrank();

        uint256 depositAmount = 500 * 10**6;
        
        usdtEth.mint(user, depositAmount);
        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount);
        vm.stopPrank();

        vm.prank(user);
        vm.expectRevert("PUSDManager: preferred asset unavailable and basket not allowed");
        manager.redeem(depositAmount, address(usdcEth), false);
    }

    function testDepositEvent() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount = 1000 * 10**6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);

        vm.expectEmit(true, true, false, true);
        emit PUSDManager.Deposited(user, address(usdtEth), depositAmount, depositAmount);
        manager.deposit(address(usdtEth), depositAmount);
        vm.stopPrank();
    }

    function testRedeemEvent() public {
        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount = 1000 * 10**6;
        usdtEth.mint(user, depositAmount);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount);

        uint256 redeemAmount = 500 * 10**6;
        vm.expectEmit(true, true, false, true);
        emit PUSDManager.Redeemed(user, address(usdtEth), redeemAmount, redeemAmount);
        manager.redeem(redeemAmount, address(usdtEth), false);
        vm.stopPrank();
    }

    function testMultipleUsersDepositAndRedeem() public {
        address user2 = address(3);

        vm.prank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);

        uint256 depositAmount1 = 1000 * 10**6;
        uint256 depositAmount2 = 2000 * 10**6;

        usdtEth.mint(user, depositAmount1);
        usdtEth.mint(user2, depositAmount2);

        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount1);
        manager.deposit(address(usdtEth), depositAmount1);
        vm.stopPrank();

        vm.startPrank(user2);
        usdtEth.approve(address(manager), depositAmount2);
        manager.deposit(address(usdtEth), depositAmount2);
        vm.stopPrank();

        assertEq(pusd.balanceOf(user), depositAmount1);
        assertEq(pusd.balanceOf(user2), depositAmount2);
        assertEq(usdtEth.balanceOf(address(manager)), depositAmount1 + depositAmount2);

        vm.prank(user);
        manager.redeem(depositAmount1, address(usdtEth), false);

        assertEq(pusd.balanceOf(user), 0);
        assertEq(usdtEth.balanceOf(user), depositAmount1);
        assertEq(usdtEth.balanceOf(address(manager)), depositAmount2);
    }

    function testRedeemWithFallback() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        vm.stopPrank();

        uint256 depositAmount = 1000 * 10**6;
        
        usdcEth.mint(user, depositAmount);
        vm.startPrank(user);
        usdcEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdcEth), depositAmount);
        vm.stopPrank();

        vm.prank(user);
        manager.redeem(depositAmount, address(usdtEth), true);

        assertEq(pusd.balanceOf(user), 0);
        assertEq(usdcEth.balanceOf(user), depositAmount);
        assertEq(usdcEth.balanceOf(address(manager)), 0);
    }

    function testRedeemWithFallbackMultipleTokens() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdtBnb), "USDT.bnb", "BNB_Testnet", 18);
        vm.stopPrank();

        uint256 depositUSDC = 500 * 10**6;
        uint256 depositBNB = 500 * 10**18;
        
        usdcEth.mint(user, depositUSDC);
        usdtBnb.mint(user, depositBNB);
        
        vm.startPrank(user);
        usdcEth.approve(address(manager), depositUSDC);
        manager.deposit(address(usdcEth), depositUSDC);
        
        usdtBnb.approve(address(manager), depositBNB);
        manager.deposit(address(usdtBnb), depositBNB);
        vm.stopPrank();

        uint256 redeemAmount = 500 * 10**6;
        vm.prank(user);
        manager.redeem(redeemAmount, address(usdtEth), true);

        assertEq(pusd.balanceOf(user), 500 * 10**6);
        assertTrue(usdcEth.balanceOf(user) > 0 || usdtBnb.balanceOf(user) > 0);
    }

    function testRedeemPreferredAssetAvailable() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        vm.stopPrank();

        uint256 depositAmount = 1000 * 10**6;
        
        usdtEth.mint(user, depositAmount);
        usdcEth.mint(user, depositAmount);
        
        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount);
        
        usdcEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdcEth), depositAmount);
        vm.stopPrank();

        uint256 redeemAmount = 500 * 10**6;
        vm.prank(user);
        manager.redeem(redeemAmount, address(usdtEth), true);

        assertEq(pusd.balanceOf(user), 1500 * 10**6);
        assertEq(usdtEth.balanceOf(user), 500 * 10**6);
        assertEq(usdcEth.balanceOf(user), 0);
    }

    function testBasketRedeemRoundingFix() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdtSol), "USDT.sol", "Solana_Devnet", 6);
        vm.stopPrank();

        usdtEth.mint(user, 333 * 10**6);
        usdcEth.mint(user, 333 * 10**6);
        usdtSol.mint(user, 334 * 10**6);
        
        vm.startPrank(user);
        usdtEth.approve(address(manager), 333 * 10**6);
        manager.deposit(address(usdtEth), 333 * 10**6);
        
        usdcEth.approve(address(manager), 333 * 10**6);
        manager.deposit(address(usdcEth), 333 * 10**6);
        
        usdtSol.approve(address(manager), 334 * 10**6);
        manager.deposit(address(usdtSol), 334 * 10**6);
        vm.stopPrank();

        uint256 userPUSDBefore = pusd.balanceOf(user);
        assertEq(userPUSDBefore, 1000 * 10**6);

        uint256 redeemAmount = 100 * 10**6;
        
        vm.prank(user);
        manager.redeem(redeemAmount, address(usdtArb), true);

        uint256 userPUSDAfter = pusd.balanceOf(user);
        assertEq(userPUSDAfter, userPUSDBefore - redeemAmount, "User should have exactly redeemAmount less PUSD");

        uint256 totalTokensReceived = usdtEth.balanceOf(user) + usdcEth.balanceOf(user) + usdtSol.balanceOf(user);
        assertEq(totalTokensReceived, redeemAmount, "User should receive tokens worth exactly the PUSD burned");
    }

    function testBasketRedeemWithOddAmounts() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdtSol), "USDT.sol", "Solana_Devnet", 6);
        manager.addSupportedToken(address(usdcSol), "USDC.sol", "Solana_Devnet", 6);
        manager.addSupportedToken(address(usdtBase), "USDT.base", "Base_Testnet", 6);
        vm.stopPrank();

        usdtEth.mint(user, 1234567);
        usdcEth.mint(user, 2345678);
        usdtSol.mint(user, 3456789);
        usdcSol.mint(user, 4567890);
        usdtBase.mint(user, 5678901);
        
        vm.startPrank(user);
        usdtEth.approve(address(manager), 1234567);
        manager.deposit(address(usdtEth), 1234567);
        
        usdcEth.approve(address(manager), 2345678);
        manager.deposit(address(usdcEth), 2345678);
        
        usdtSol.approve(address(manager), 3456789);
        manager.deposit(address(usdtSol), 3456789);
        
        usdcSol.approve(address(manager), 4567890);
        manager.deposit(address(usdcSol), 4567890);
        
        usdtBase.approve(address(manager), 5678901);
        manager.deposit(address(usdtBase), 5678901);
        vm.stopPrank();

        uint256 userPUSDBefore = pusd.balanceOf(user);
        uint256 redeemAmount = 9876543;
        
        vm.prank(user);
        manager.redeem(redeemAmount, address(usdtArb), true);

        uint256 userPUSDAfter = pusd.balanceOf(user);
        assertEq(userPUSDAfter, userPUSDBefore - redeemAmount, "User should have exactly redeemAmount less PUSD");

        uint256 totalTokensReceived = usdtEth.balanceOf(user) + usdcEth.balanceOf(user) + 
                                       usdtSol.balanceOf(user) + usdcSol.balanceOf(user) + 
                                       usdtBase.balanceOf(user);
        assertEq(totalTokensReceived, redeemAmount, "User should receive tokens worth exactly the PUSD burned");
    }

    function testEmergencyRedeemProportionalDistribution() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdcSol), "USDC.sol", "Solana_Devnet", 6);
        manager.addSupportedToken(address(usdcBase), "USDC.base", "Base_Testnet", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdtBase), "USDT.base", "Base_Testnet", 6);
        vm.stopPrank();

        uint256 depositAmount = 100 * 10**6;
        usdcSol.mint(user, depositAmount);
        usdcBase.mint(user, depositAmount);
        usdcEth.mint(user, depositAmount);
        usdtEth.mint(user, depositAmount);
        usdtBase.mint(user, depositAmount);
        
        vm.startPrank(user);
        usdcSol.approve(address(manager), depositAmount);
        manager.deposit(address(usdcSol), depositAmount);
        
        usdcBase.approve(address(manager), depositAmount);
        manager.deposit(address(usdcBase), depositAmount);
        
        usdcEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdcEth), depositAmount);
        
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount);
        
        usdtBase.approve(address(manager), depositAmount);
        manager.deposit(address(usdtBase), depositAmount);
        vm.stopPrank();

        vm.prank(admin);
        manager.setTokenStatus(address(usdcSol), PUSDManager.TokenStatus.EMERGENCY_REDEEM);

        uint256 redeemAmount = 50 * 10**6;
        
        vm.prank(user);
        manager.redeem(redeemAmount, address(usdcBase), false);

        uint256 usdcSolReceived = usdcSol.balanceOf(user);
        uint256 usdcBaseReceived = usdcBase.balanceOf(user);
        
        assertGt(usdcSolReceived, 0, "Should receive some USDC.sol (emergency token)");
        assertGt(usdcBaseReceived, 0, "Should receive some USDC.base (preferred token)");
        
        uint256 totalReceived = usdcSolReceived + usdcBaseReceived;
        assertEq(totalReceived, redeemAmount, "Total should equal redeem amount");
        
        assertEq(usdcSolReceived, 25 * 10**6, "Should receive 50% from emergency token (100/200)");
        assertEq(usdcBaseReceived, 25 * 10**6, "Should receive 50% from preferred token (100/200)");
    }

    function testEmergencyRedeemMultipleEmergencyTokens() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdcSol), "USDC.sol", "Solana_Devnet", 6);
        manager.addSupportedToken(address(usdcBase), "USDC.base", "Base_Testnet", 6);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        vm.stopPrank();

        uint256 depositAmount = 100 * 10**6;
        usdcSol.mint(user, depositAmount);
        usdcBase.mint(user, depositAmount);
        usdtEth.mint(user, depositAmount);
        
        vm.startPrank(user);
        usdcSol.approve(address(manager), depositAmount);
        manager.deposit(address(usdcSol), depositAmount);
        
        usdcBase.approve(address(manager), depositAmount);
        manager.deposit(address(usdcBase), depositAmount);
        
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount);
        vm.stopPrank();

        vm.startPrank(admin);
        manager.setTokenStatus(address(usdcSol), PUSDManager.TokenStatus.EMERGENCY_REDEEM);
        manager.setTokenStatus(address(usdtEth), PUSDManager.TokenStatus.EMERGENCY_REDEEM);
        vm.stopPrank();

        uint256 redeemAmount = 60 * 10**6;
        
        vm.prank(user);
        manager.redeem(redeemAmount, address(usdcBase), false);

        uint256 totalReceived = usdcSol.balanceOf(user) + usdcBase.balanceOf(user) + usdtEth.balanceOf(user);
        assertEq(totalReceived, redeemAmount, "Total should equal redeem amount");
        
        assertGt(usdcSol.balanceOf(user), 0, "Should receive USDC.sol");
        assertGt(usdcBase.balanceOf(user), 0, "Should receive USDC.base");
        assertGt(usdtEth.balanceOf(user), 0, "Should receive USDT.eth");
    }

    function testEmergencyRedeemCanUseEmergencyAsPreferred() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdcSol), "USDC.sol", "Solana_Devnet", 6);
        manager.addSupportedToken(address(usdcBase), "USDC.base", "Base_Testnet", 6);
        vm.stopPrank();

        uint256 depositAmount = 100 * 10**6;
        usdcSol.mint(user, depositAmount);
        usdcBase.mint(user, depositAmount);
        
        vm.startPrank(user);
        usdcSol.approve(address(manager), depositAmount);
        manager.deposit(address(usdcSol), depositAmount);
        
        usdcBase.approve(address(manager), depositAmount);
        manager.deposit(address(usdcBase), depositAmount);
        vm.stopPrank();

        vm.prank(admin);
        manager.setTokenStatus(address(usdcSol), PUSDManager.TokenStatus.EMERGENCY_REDEEM);

        uint256 redeemAmount = 50 * 10**6;
        
        vm.prank(user);
        manager.redeem(redeemAmount, address(usdcSol), false);

        assertGt(usdcSol.balanceOf(user), 0, "Should be able to redeem emergency token as preferred");
    }

    function testSetFeeCollector() public {
        address feeCollector = address(0x123);
        
        vm.prank(admin);
        manager.setFeeCollector(feeCollector);
        
        assertEq(manager.feeCollector(), feeCollector);
    }

    function testSetBaseFee() public {
        vm.prank(admin);
        manager.setBaseFee(5); // 5 bps = 0.05%
        
        assertEq(manager.baseFee(), 5);
    }

    function testSetPreferredFeeRange() public {
        vm.prank(admin);
        manager.setPreferredFeeRange(5, 15); // 5-15 bps
        
        assertEq(manager.preferredFeeMin(), 5);
        assertEq(manager.preferredFeeMax(), 15);
    }

    function testPreferredRedemptionWithFees() public {
        address feeCollector = address(0x999);
        
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.setFeeCollector(feeCollector);
        manager.setBaseFee(5); // 0.05%
        manager.setPreferredFeeRange(5, 15); // 0.05% - 0.15%
        vm.stopPrank();

        uint256 depositAmount = 1000 * 10**6;
        usdtEth.mint(user, depositAmount);
        
        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount);
        
        uint256 redeemAmount = 500 * 10**6;
        manager.redeem(redeemAmount, address(usdtEth), false);
        vm.stopPrank();

        // Calculate expected fee (base + preferred)
        // With 100% liquidity in one token, preferred fee should be min (5 bps)
        // Total fee = 5 + 5 = 10 bps = 0.1%
        uint256 expectedFee = (redeemAmount * 10) / 10000;
        uint256 expectedUserAmount = redeemAmount - expectedFee;
        
        assertEq(usdtEth.balanceOf(user), expectedUserAmount, "User should receive amount minus fees");
        assertEq(usdtEth.balanceOf(feeCollector), expectedFee, "Fee collector should receive fees");
    }

    function testBasketRedemptionWithOnlyBaseFee() public {
        address feeCollector = address(0x999);
        
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.setFeeCollector(feeCollector);
        manager.setBaseFee(5); // 0.05%
        manager.setPreferredFeeRange(5, 15);
        vm.stopPrank();

        uint256 depositAmount = 500 * 10**6;
        usdtEth.mint(user, depositAmount);
        usdcEth.mint(user, depositAmount);
        
        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount);
        
        usdcEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdcEth), depositAmount);
        
        uint256 redeemAmount = 500 * 10**6;
        manager.redeem(redeemAmount, address(usdtBase), true); // Basket redemption
        vm.stopPrank();

        // Basket redemption should only charge base fee (5 bps)
        uint256 totalReceived = usdtEth.balanceOf(user) + usdcEth.balanceOf(user);
        uint256 totalFees = usdtEth.balanceOf(feeCollector) + usdcEth.balanceOf(feeCollector);
        
        // Total fees should be approximately 5 bps of redeemAmount
        uint256 expectedTotalFee = (redeemAmount * 5) / 10000;
        
        assertApproxEqAbs(totalReceived + totalFees, redeemAmount, 2, "Total should equal redeem amount");
        assertApproxEqAbs(totalFees, expectedTotalFee, 2, "Fees should be approximately base fee only");
    }

    function testDynamicPreferredFeeCalculation() public {
        address feeCollector = address(0x999);
        
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.addSupportedToken(address(usdcEth), "USDC.eth", "Ethereum_Sepolia", 6);
        manager.setFeeCollector(feeCollector);
        manager.setBaseFee(5);
        manager.setPreferredFeeRange(5, 15); // Min 5 bps, Max 15 bps
        vm.stopPrank();

        // Create imbalanced liquidity: 900 USDT, 100 USDC
        usdtEth.mint(user, 900 * 10**6);
        usdcEth.mint(user, 100 * 10**6);
        
        vm.startPrank(user);
        usdtEth.approve(address(manager), 900 * 10**6);
        manager.deposit(address(usdtEth), 900 * 10**6);
        
        usdcEth.approve(address(manager), 100 * 10**6);
        manager.deposit(address(usdcEth), 100 * 10**6);
        vm.stopPrank();

        // Redeem USDT (90% liquidity) - should have lower preferred fee (close to min)
        vm.prank(user);
        manager.redeem(100 * 10**6, address(usdtEth), false);
        
        uint256 usdtFee = usdtEth.balanceOf(feeCollector);
        
        // Redeem USDC (10% liquidity) - should have higher preferred fee (max)
        vm.prank(user);
        manager.redeem(50 * 10**6, address(usdcEth), false);
        
        uint256 usdcFee = usdcEth.balanceOf(feeCollector);
        
        // USDC fee rate should be higher than USDT fee rate
        uint256 usdtFeeRate = (usdtFee * 10000) / (100 * 10**6);
        uint256 usdcFeeRate = (usdcFee * 10000) / (50 * 10**6);
        
        assertGt(usdcFeeRate, usdtFeeRate, "Low liquidity token should have higher fee");
    }

    function testNoFeesWhenFeeCollectorNotSet() public {
        vm.startPrank(admin);
        manager.addSupportedToken(address(usdtEth), "USDT.eth", "Ethereum_Sepolia", 6);
        manager.setBaseFee(5);
        manager.setPreferredFeeRange(5, 15);
        vm.stopPrank();

        uint256 depositAmount = 1000 * 10**6;
        usdtEth.mint(user, depositAmount);
        
        vm.startPrank(user);
        usdtEth.approve(address(manager), depositAmount);
        manager.deposit(address(usdtEth), depositAmount);
        
        uint256 redeemAmount = 500 * 10**6;
        manager.redeem(redeemAmount, address(usdtEth), false);
        vm.stopPrank();

        // Without fee collector, user should receive full amount
        assertEq(usdtEth.balanceOf(user), redeemAmount, "User should receive full amount without fee collector");
    }
}
