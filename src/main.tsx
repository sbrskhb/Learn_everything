import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

class RootErrorBoundary extends React.Component<
  {children: React.ReactNode},
  {error: Error | null}
> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = {error: null};
  }

  static getDerivedStateFromError(error: Error) {
    return {error};
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-black text-neutral-100 p-6 font-mono text-xs">
          <div className="max-w-2xl mx-auto border border-neutral-800 rounded-lg p-4 bg-neutral-950">
            <div className="text-red-400 font-semibold mb-2">页面渲染异常</div>
            <pre className="whitespace-pre-wrap break-words text-neutral-300">
              {this.state.error.stack || this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

document.getElementById('boot-status')?.remove();

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);
