import { usePushChain, usePushChainClient, usePushWalletContext } from '@pushchain/ui-kit';
import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { PUSD_ADDRESS, PUSD_MANAGER_ADDRESS, RPC_URL } from '../contracts/config';

const SUPPORTED_TOKENS = [
  { address: '0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3', symbol: 'USDT.eth', chain: 'Ethereum Sepolia', decimals: 6 },
  { address: '0x387b9C8Db60E74999aAAC5A2b7825b400F12d68E', symbol: 'USDC.eth', chain: 'Ethereum Sepolia', decimals: 6 },
  { address: '0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34', symbol: 'USDT.sol', chain: 'Solana Devnet', decimals: 6 },
  { address: '0x04B8F634ABC7C879763F623e0f0550a4b5c4426F', symbol: 'USDC.sol', chain: 'Solana Devnet', decimals: 6 },
  { address: '0x2C455189D2af6643B924A981a9080CcC63d5a567', symbol: 'USDT.base', chain: 'Base Testnet', decimals: 6 },
  { address: '0x84B62e44F667F692F7739Ca6040cD17DA02068A8', symbol: 'USDC.base', chain: 'Base Testnet', decimals: 6 },
  { address: '0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9', symbol: 'USDT.arb', chain: 'Arbitrum Sepolia', decimals: 6 },
  { address: '0xa261A10e94aE4bA88EE8c5845CbE7266bD679DD6', symbol: 'USDC.arb', chain: 'Arbitrum Sepolia', decimals: 6 },
  { address: '0x2f98B4235FD2BA0173a2B056D722879360B12E7b', symbol: 'USDT.bnb', chain: 'BNB Testnet', decimals: 6 },
];

const MANAGER_ABI = [
  { inputs: [{ name: "pusdAmount", type: "uint256" }, { name: "preferredAsset", type: "address" }, { name: "allowBasket", type: "bool" }], name: "redeem", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "amount", type: "uint256" }], name: "calculateFee", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" }
];

const ERC20_ABI = [
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ name: "", type: "bool" }], stateMutability: "nonpayable", type: "function" }
];

const PUSD_ABI = [
  "function balanceOf(address account) external view returns (uint256)"
];

const provider = new ethers.JsonRpcProvider(RPC_URL);

export function RedeemTab() {
  const { connectionStatus } = usePushWalletContext();
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();
  
  const [selectedToken, setSelectedToken] = useState(SUPPORTED_TOKENS[0]);
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState('0');
  const [fee, setFee] = useState('0');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchBalance = async () => {
      if (connectionStatus !== 'connected' || !pushChainClient?.universal.account) return;

      try {
        const contract = new ethers.Contract(PUSD_ADDRESS, PUSD_ABI, provider);
        const bal = await contract.balanceOf(pushChainClient.universal.account);
        // PUSD uses 6 decimals
        setBalance(ethers.formatUnits(bal, 6));
      } catch (err) {
        console.error('Error fetching balance:', err);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [connectionStatus, pushChainClient]);

  useEffect(() => {
    const calculateFee = async () => {
      if (!amount || parseFloat(amount) <= 0) {
        setFee('0');
        return;
      }

      try {
        const contract = new ethers.Contract(PUSD_MANAGER_ADDRESS, MANAGER_ABI, provider);
        // PUSD uses 6 decimals
        const amountBigInt = ethers.parseUnits(amount, 6);
        const feeData = await contract.calculateFee(amountBigInt);
        // Fee is returned in PUSD decimals (6)
        const feeInPUSD = ethers.formatUnits(feeData, 6);
        setFee(feeInPUSD);
      } catch (err) {
        console.error('Error calculating fee:', err);
        setFee('0');
      }
    };

    calculateFee();
  }, [amount, selectedToken]);

  const handleRedeem = async () => {
    if (!amount || !pushChainClient) {
      setError('Please enter an amount and connect your wallet');
      return;
    }

    if (parseFloat(amount) > parseFloat(balance)) {
      setError('Insufficient balance');
      return;
    }

    setIsRedeeming(true);
    setError('');
    setTxHash('');

    try {
      if (!PushChain) { setError('PushChain not initialized'); return; }
      
      // PUSD uses 6 decimals
      const amountBigInt = PushChain.utils.helpers.parseUnits(amount, 6);
      
      // Call 1: Approve PUSDManager to spend PUSD
      const approveData = PushChain.utils.helpers.encodeTxData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [PUSD_MANAGER_ADDRESS, amountBigInt]
      });
      
      // Call 2: Redeem PUSD for preferred token
      const redeemData = PushChain.utils.helpers.encodeTxData({
        abi: MANAGER_ABI,
        functionName: 'redeem',
        args: [amountBigInt, selectedToken.address, false]
      });
      
      // Multicall: execute both calls atomically
      const calls = [
        { to: PUSD_ADDRESS, value: BigInt(0), data: approveData },
        { to: PUSD_MANAGER_ADDRESS, value: BigInt(0), data: redeemData }
      ];

      const tx = await pushChainClient.universal.sendTransaction({
        to: pushChainClient.universal.account,
        value: BigInt(0),
        data: calls
      });

      setTxHash(tx.hash);
      await tx.wait();
      
      setAmount('');
      setIsRedeeming(false);
    } catch (err) {
      console.error('Redeem error:', err);
      setError(err instanceof Error ? err.message : 'Failed to redeem PUSD');
      setIsRedeeming(false);
    }
  };

  // Calculate receive amount: PUSD amount minus fee, displayed in token decimals
  const receiveAmount = amount && fee 
    ? (parseFloat(amount) - parseFloat(fee)).toFixed(6)
    : '0';

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-gray-800 rounded-lg p-6 space-y-6">
        <h2 className="text-2xl font-bold">Redeem PUSD</h2>
        
        {connectionStatus !== 'connected' ? (
          <div className="text-center py-8">
            <p className="text-gray-400 mb-4">Connect your wallet to redeem PUSD</p>
          </div>
        ) : (
          <>
            <div className="bg-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-400">Your PUSD Balance</p>
              <p className="text-2xl font-bold">{parseFloat(balance).toFixed(6)} PUSD</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Redeem To</label>
              <select
                value={selectedToken.address}
                onChange={(e) => {
                  const token = SUPPORTED_TOKENS.find(t => t.address === e.target.value);
                  if (token) setSelectedToken(token);
                }}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {SUPPORTED_TOKENS.map((token) => (
                  <option key={token.address} value={token.address}>
                    {token.symbol} - {token.chain}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Amount</label>
              <div className="relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => setAmount(balance)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-blue-400 hover:text-blue-300"
                >
                  MAX
                </button>
              </div>
            </div>

            {amount && parseFloat(amount) > 0 && (
              <div className="bg-gray-700 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Fee (0.05%)</span>
                  <span>{fee} PUSD</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>You will receive</span>
                  <span className="text-green-400">{receiveAmount} {selectedToken.symbol}</span>
                </div>
              </div>
            )}

            <button
              onClick={handleRedeem}
              disabled={!amount || isRedeeming || parseFloat(amount) > parseFloat(balance)}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              {isRedeeming ? 'Redeeming...' : 'Redeem PUSD'}
            </button>

            {error && (
              <div className="bg-red-900/50 border border-red-500 rounded-lg p-4">
                <p className="text-red-400">{error}</p>
              </div>
            )}

            {txHash && (
              <div className="bg-green-900/50 border border-green-500 rounded-lg p-4">
                <p className="text-green-400 font-semibold">✓ Successfully redeemed PUSD!</p>
                <a
                  href={`https://donut.push.network/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:text-blue-300 mt-2 inline-block"
                >
                  View transaction →
                </a>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-6 bg-gray-800 rounded-lg p-6">
        <h3 className="font-semibold mb-3">How to Redeem</h3>
        <ol className="space-y-2 text-sm text-gray-300">
          <li className="flex items-start">
            <span className="font-bold mr-2">1.</span>
            <span>Select the stablecoin you want to receive</span>
          </li>
          <li className="flex items-start">
            <span className="font-bold mr-2">2.</span>
            <span>Enter the amount of PUSD to redeem</span>
          </li>
          <li className="flex items-start">
            <span className="font-bold mr-2">3.</span>
            <span>Confirm the transaction to receive your stablecoin</span>
          </li>
        </ol>
      </div>
    </div>
  );
}
