import { usePushChainClient, usePushWalletContext } from '@pushchain/ui-kit';
import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { PUSD_ADDRESS, PUSD_MANAGER_ADDRESS, RPC_URL } from '../contracts/config';

const PUSD_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)"
];

const MANAGER_ABI = [
  "function getSupportedTokensCount() external view returns (uint256)",
  "function baseFee() external view returns (uint256)",
  "function getSupportedTokenAt(uint256 index) external view returns (address)",
  "function getTokenInfo(address token) external view returns (tuple(string symbol, string name, uint8 decimals, bool isActive, uint256 balance))"
];

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)"
];

const provider = new ethers.JsonRpcProvider(RPC_URL);

export function DashboardTab() {
  const { connectionStatus } = usePushWalletContext();
  const { pushChainClient } = usePushChainClient();

  const [balance, setBalance] = useState('0');
  const [totalSupply, setTotalSupply] = useState('0');
  const [tokensCount, setTokensCount] = useState(0);
  const [baseFee, setBaseFee] = useState('0');
  const [reserves, setReserves] = useState<Array<{symbol: string, balance: string, decimals: number}>>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const pusdContract = new ethers.Contract(PUSD_ADDRESS, PUSD_ABI, provider);
        const managerContract = new ethers.Contract(PUSD_MANAGER_ADDRESS, MANAGER_ABI, provider);

        const [supply, count, fee] = await Promise.all([
          pusdContract.totalSupply(),
          managerContract.getSupportedTokensCount(),
          managerContract.baseFee()
        ]);

        // PUSD uses 6 decimals
        setTotalSupply(ethers.formatUnits(supply, 6));
        setTokensCount(Number(count));
        setBaseFee((Number(fee) / 100).toFixed(2));

        // Fetch reserves for all supported tokens (they also use 6 decimals)
        const reservesData = [];
        for (let i = 0; i < Number(count); i++) {
          try {
            const tokenAddress = await managerContract.getSupportedTokenAt(i);
            const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
            const [symbol, decimals, balance] = await Promise.all([
              tokenContract.symbol(),
              tokenContract.decimals(),
              tokenContract.balanceOf(PUSD_MANAGER_ADDRESS)
            ]);
            reservesData.push({
              symbol,
              balance: ethers.formatUnits(balance, decimals),
              decimals: Number(decimals)
            });
          } catch (err) {
            console.error(`Error fetching token ${i}:`, err);
          }
        }
        setReserves(reservesData);

        if (connectionStatus === 'connected' && pushChainClient?.universal.account) {
          const bal = await pusdContract.balanceOf(pushChainClient.universal.account);
          // PUSD uses 6 decimals
          setBalance(ethers.formatUnits(bal, 6));
        }
      } catch (err) {
        console.error('Error fetching data:', err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [connectionStatus, pushChainClient]);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Dashboard</h2>

      {connectionStatus !== 'connected' ? (
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-400">Connect your wallet to view your dashboard</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gradient-to-br from-blue-900 to-blue-800 rounded-lg p-6">
              <p className="text-sm text-blue-200 mb-2">Your PUSD Balance</p>
              <p className="text-3xl font-bold">{parseFloat(balance).toFixed(6)}</p>
              <p className="text-sm text-blue-200 mt-1">PUSD</p>
            </div>

            <div className="bg-gradient-to-br from-purple-900 to-purple-800 rounded-lg p-6">
              <p className="text-sm text-purple-200 mb-2">Your Wallet</p>
              <p className="text-sm font-mono break-all">{pushChainClient?.universal.account}</p>
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-xl font-semibold mb-4">Your Assets</h3>
            {parseFloat(balance) > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-gray-700 rounded-lg p-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center font-bold">
                      P
                    </div>
                    <div>
                      <p className="font-semibold">PUSD</p>
                      <p className="text-sm text-gray-400">Push USD Stablecoin</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{parseFloat(balance).toFixed(6)}</p>
                    <p className="text-sm text-gray-400">≈ ${parseFloat(balance).toFixed(2)}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <p>No assets yet. Mint some PUSD to get started!</p>
              </div>
            )}
          </div>
        </>
      )}

      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-xl font-semibold mb-4">Protocol Statistics</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-700 rounded-lg p-4">
            <p className="text-sm text-gray-400 mb-1">Total Supply</p>
            <p className="text-2xl font-bold">{parseFloat(totalSupply).toFixed(2)}</p>
            <p className="text-sm text-gray-400">PUSD</p>
          </div>

          <div className="bg-gray-700 rounded-lg p-4">
            <p className="text-sm text-gray-400 mb-1">Supported Tokens</p>
            <p className="text-2xl font-bold">{tokensCount}</p>
            <p className="text-sm text-gray-400">Stablecoins</p>
          </div>

          <div className="bg-gray-700 rounded-lg p-4">
            <p className="text-sm text-gray-400 mb-1">Base Fee</p>
            <p className="text-2xl font-bold">{baseFee}%</p>
            <p className="text-sm text-gray-400">Per transaction</p>
          </div>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-xl font-semibold mb-4">Push Chain Reserves</h3>
        {reserves.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {reserves.map((reserve, idx) => (
              <div key={idx} className="bg-gray-700 rounded-lg p-4">
                <p className="text-sm text-gray-400 mb-1">{reserve.symbol}</p>
                <p className="text-xl font-bold">{parseFloat(reserve.balance).toFixed(6)}</p>
                <p className="text-xs text-gray-400 mt-1">Held in PUSDManager</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400">
            <p>Loading reserves...</p>
          </div>
        )}
      </div>

      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-xl font-semibold mb-4">Recent Activity</h3>
        <div className="text-center py-8 text-gray-400">
          <p>No recent activity</p>
          <p className="text-sm mt-2">Your transactions will appear here</p>
        </div>
      </div>
    </div>
  );
}
