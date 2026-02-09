import './App.css'
import { PushUniversalAccountButton, usePushWalletContext } from '@pushchain/ui-kit'

function App() {
  const { universalAccount } = usePushWalletContext()

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-[800px] mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-[2.5rem] font-bold mb-4">
            Welcome to my-push-app
          </h1>
          <p className="text-[1.2rem] text-gray-400 mb-8">
            Your Push Chain application is ready to go!
          </p>
        </div>

        <div className="max-w-[600px] mx-auto p-8 border border-gray-300 rounded-lg text-center">
          <h2 className="mb-4">Push Chain Integration</h2>

          <div className="mb-4">
            <span
              className={
                "px-2 py-1 rounded text-white text-[12px] " +
                (universalAccount ? "bg-green-500" : "bg-gray-500")
              }
            >
              {universalAccount ? "Connected" : "Not Connected"}
            </span>
          </div>

          <div className="mb-8 justify-items-center">
            <PushUniversalAccountButton />
          </div>

          {universalAccount && (
            <div className="mt-8 p-4 bg-gray-100 text-neutral-800 rounded-md text-left">
              <h3 className="font-bold mb-2">Account Details:</h3>
              <pre className="text-[0.8rem] overflow-auto">
                {JSON.stringify(universalAccount, null, 2)}
              </pre>
            </div>
          )}

          <div className="text-[0.9rem] text-gray-400 mt-8 text-left">
            <p><strong>Next steps:</strong></p>
            <ul className="my-2 pl-6 list-disc">
              <li>Update walletConfig/appMetadata in <code>src/main.tsx</code></li>
              <li>Add more chains + RPC URLs</li>
              <li>Explore the @pushchain/ui-kit for more components</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
