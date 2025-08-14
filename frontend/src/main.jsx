import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AptosWalletAdapterProvider } from '@aptos-labs/wallet-adapter-react'
import { PetraWallet } from 'petra-plugin-wallet-adapter'

const wallets = [new PetraWallet()];

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AptosWalletAdapterProvider
      plugins={wallets}
      autoConnect={true}
    >
      <App />
    </AptosWalletAdapterProvider>
  </StrictMode>
);
