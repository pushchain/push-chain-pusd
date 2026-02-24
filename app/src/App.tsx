import { PushUniversalAccountButton } from "@pushchain/ui-kit";
import { useState } from "react";
import { DashboardTab } from "./components/DashboardTab";
import { InfoTab } from "./components/InfoTab";
import { MintTab } from "./components/MintTab";
import { RedeemTab } from "./components/RedeemTab";

type Tab = 'info' | 'mint' | 'redeem' | 'dashboard';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('info');

  const tabs = [
    { id: 'info' as Tab, label: 'Info', icon: 'ℹ️' },
    { id: 'mint' as Tab, label: 'Mint', icon: '💰' },
    { id: 'redeem' as Tab, label: 'Redeem', icon: '🔄' },
    { id: 'dashboard' as Tab, label: 'Dashboard', icon: '📊' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-700 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center font-bold text-xl">
                P
              </div>
              <div>
                <h1 className="text-2xl font-bold">PUSD</h1>
                <p className="text-xs text-gray-400">Multi-Chain Stablecoin</p>
              </div>
            </div>
            <PushUniversalAccountButton />
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-700 bg-gray-900/30">
        <div className="container mx-auto px-4">
          <nav className="flex space-x-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-6 py-4 font-medium transition-colors relative ${
                  activeTab === tab.id
                    ? 'text-blue-400'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400" />
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {activeTab === 'info' && <InfoTab />}
        {activeTab === 'mint' && <MintTab />}
        {activeTab === 'redeem' && <RedeemTab />}
        {activeTab === 'dashboard' && <DashboardTab />}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-700 bg-gray-900/50 mt-12">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between text-sm text-gray-400">
            <p>© 2024 PUSD. Multi-chain stablecoin on Push Chain.</p>
            <div className="flex space-x-4 mt-4 md:mt-0">
              <a
                href="https://donut.push.network"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-blue-400 transition-colors"
              >
                Explorer
              </a>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-blue-400 transition-colors"
              >
                GitHub
              </a>
              <a
                href="https://docs.push.org"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-blue-400 transition-colors"
              >
                Docs
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
