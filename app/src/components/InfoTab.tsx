import { PUSD_ADDRESS, PUSD_MANAGER_ADDRESS } from '../contracts/config';

export function InfoTab() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-4">About PUSD</h2>
        <p className="text-gray-300 mb-4">
          PUSD is a multi-chain stablecoin backed by various stablecoins across different blockchains.
          Mint PUSD by depositing supported stablecoins, and redeem your PUSD back to any supported stablecoin.
        </p>
      </div>

      <div className="bg-gray-800 rounded-lg p-6 space-y-4">
        <h3 className="text-xl font-semibold mb-3">Contract Addresses</h3>
        
        <div>
          <p className="text-sm text-gray-400 mb-1">PUSD Token</p>
          <a
            href={`https://donut.push.network/address/${PUSD_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 font-mono text-sm break-all"
          >
            {PUSD_ADDRESS}
          </a>
        </div>

        <div>
          <p className="text-sm text-gray-400 mb-1">PUSD Manager</p>
          <a
            href={`https://donut.push.network/address/${PUSD_MANAGER_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 font-mono text-sm break-all"
          >
            {PUSD_MANAGER_ADDRESS}
          </a>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-xl font-semibold mb-3">Supported Tokens</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { name: 'USDT', chain: 'Ethereum Sepolia' },
            { name: 'USDC', chain: 'Ethereum Sepolia' },
            { name: 'USDT', chain: 'Solana Devnet' },
            { name: 'USDC', chain: 'Solana Devnet' },
            { name: 'USDT', chain: 'Base Testnet' },
            { name: 'USDC', chain: 'Base Testnet' },
            { name: 'USDT', chain: 'Arbitrum Sepolia' },
            { name: 'USDC', chain: 'Arbitrum Sepolia' },
            { name: 'USDT', chain: 'BNB Testnet' },
          ].map((token, idx) => (
            <div key={idx} className="bg-gray-700 rounded p-3">
              <p className="font-semibold">{token.name}</p>
              <p className="text-sm text-gray-400">{token.chain}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-xl font-semibold mb-3">Features</h3>
        <ul className="space-y-2 text-gray-300">
          <li className="flex items-start">
            <span className="text-green-400 mr-2">✓</span>
            <span>Multi-chain stablecoin support</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-400 mr-2">✓</span>
            <span>Low fees (0.05% base fee)</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-400 mr-2">✓</span>
            <span>1:1 backing with supported stablecoins</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-400 mr-2">✓</span>
            <span>Upgradeable smart contracts</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-400 mr-2">✓</span>
            <span>Transparent on-chain operations</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
