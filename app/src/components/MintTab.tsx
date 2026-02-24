import { usePushChain, usePushChainClient, usePushWalletContext } from '@pushchain/ui-kit';
import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { PUSD_MANAGER_ADDRESS, RPC_URL } from '../contracts/config';

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
  { inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }], name: "deposit", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "amount", type: "uint256" }], name: "calculateFee", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" }
];
const ERC20_ABI = [
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ name: "", type: "bool" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" }
];
const provider = new ethers.JsonRpcProvider(RPC_URL);

export function MintTab() {
  const { connectionStatus } = usePushWalletContext();
  const { pushChainClient } = usePushChainClient();
  const { PushChain } = usePushChain();
  const [selectedToken, setSelectedToken] = useState(SUPPORTED_TOKENS[0]);
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('0');
  const [tokenBalance, setTokenBalance] = useState('0');
  const [isMinting, setIsMinting] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchBalance = async () => {
      if (connectionStatus !== 'connected' || !pushChainClient?.universal.account) {
        setTokenBalance('0');
        return;
      }
      try {
        const tokenContract = new ethers.Contract(selectedToken.address, ERC20_ABI, provider);
        const bal = await tokenContract.balanceOf(pushChainClient.universal.account);
        setTokenBalance(ethers.formatUnits(bal, selectedToken.decimals));
      } catch (err) {
        console.error('Error fetching balance:', err);
        setTokenBalance('0');
      }
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [connectionStatus, pushChainClient, selectedToken]);

  useEffect(() => {
    const calculateFee = async () => {
      if (!amount || parseFloat(amount) <= 0) { setFee('0'); return; }
      try {
        const contract = new ethers.Contract(PUSD_MANAGER_ADDRESS, MANAGER_ABI, provider);
        const amountBigInt = ethers.parseUnits(amount, selectedToken.decimals);
        const feeData = await contract.calculateFee(amountBigInt);
        setFee(ethers.formatUnits(feeData, selectedToken.decimals));
      } catch (err) { console.error('Error:', err); setFee('0'); }
    };
    calculateFee();
  }, [amount, selectedToken]);

  const handleMint = async () => {
    if (!amount || !pushChainClient || !PushChain) { setError('Connect wallet'); return; }
    setIsMinting(true); setError(''); setTxHash('');
    try {
      const amountBigInt = PushChain.utils.helpers.parseUnits(amount, selectedToken.decimals);
      
      // The funds parameter moves tokens from origin chain to the user's UEA on Push Chain
      // Then we use multicall to: 1) approve PUSDManager, 2) call deposit
      const pushChainTokenAddress = '0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3'; // USDT on Push Chain
      
      // Call 1: Approve PUSDManager to spend tokens
      const approveData = PushChain.utils.helpers.encodeTxData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [PUSD_MANAGER_ADDRESS, amountBigInt]
      });
      
      // Call 2: Deposit tokens to mint PUSD
      const depositData = PushChain.utils.helpers.encodeTxData({
        abi: MANAGER_ABI,
        functionName: 'deposit',
        args: [pushChainTokenAddress, amountBigInt]
      });
      
      // Multicall: execute both calls atomically
      const calls = [
        { to: pushChainTokenAddress, value: BigInt(0), data: approveData },
        { to: PUSD_MANAGER_ADDRESS, value: BigInt(0), data: depositData }
      ];
      
      const tx = await pushChainClient.universal.sendTransaction({ 
        to: pushChainClient.universal.account,
        value: BigInt(0),
        data: calls,
        funds: {
          amount: amountBigInt,
          token: pushChainClient.moveable.token.USDT
        }
      });
      
      setTxHash(tx.hash); await tx.wait(); setAmount(''); setIsMinting(false);
    } catch (err) { 
      console.error('Error:', err); 
      setError(err instanceof Error ? err.message : 'Failed to mint'); 
      setIsMinting(false); 
    }
  };

  const receiveAmount = amount && fee ? (parseFloat(amount) - parseFloat(fee)).toFixed(6) : '0';

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-gray-800 rounded-lg p-6 space-y-6">
        <h2 className="text-2xl font-bold">Mint PUSD</h2>
        {connectionStatus !== 'connected' ? (
          <div className="text-center py-8"><p className="text-gray-400">Connect wallet to mint PUSD</p></div>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium mb-2">Select Token</label>
              <select value={selectedToken.address} onChange={(e) => { const t = SUPPORTED_TOKENS.find(x => x.address === e.target.value); if (t) setSelectedToken(t); }} className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3">
                {SUPPORTED_TOKENS.map((t) => <option key={t.address} value={t.address}>{t.symbol} - {t.chain}</option>)}
              </select>
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium">Amount</label>
                <span className="text-sm text-gray-400">Balance: {parseFloat(tokenBalance).toFixed(6)} {selectedToken.symbol}</span>
              </div>
              <div className="relative">
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 pr-20" />
                <button onClick={() => setAmount(tokenBalance)} type="button" className="absolute right-2 top-1/2 -translate-y-1/2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3 py-1 rounded">MAX</button>
              </div>
            </div>
            {amount && parseFloat(amount) > 0 && (
              <div className="bg-gray-700 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-gray-400">Fee</span><span>{fee} {selectedToken.symbol}</span></div>
                <div className="flex justify-between font-semibold"><span>Receive</span><span className="text-green-400">{receiveAmount} PUSD</span></div>
              </div>
            )}
            <button onClick={handleMint} disabled={!amount || isMinting} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-3 px-6 rounded-lg">{isMinting ? 'Minting...' : 'Mint PUSD'}</button>
            {error && <div className="bg-red-900/50 border border-red-500 rounded-lg p-4"><p className="text-red-400">{error}</p></div>}
            {txHash && <div className="bg-green-900/50 border border-green-500 rounded-lg p-4"><p className="text-green-400 font-semibold">✓ Success!</p><a href={'https://donut.push.network/tx/' + txHash} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400">View tx →</a></div>}
          </>
        )}
      </div>
    </div>
  );
}