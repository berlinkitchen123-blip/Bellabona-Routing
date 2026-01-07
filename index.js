
import React from 'https://esm.sh/react@19.2.3';
import { createRoot } from 'https://esm.sh/react-dom@19.2.3/client';

// Use esm.sh to transpile and load the App.tsx directly from GitHub!
import App from 'https://esm.sh/gh/berlinkitchen123-blip/Bellabona-Routing/App.tsx';

function mount() {
    const rootElement = document.getElementById('root');
    if (!rootElement) return;

    const root = createRoot(rootElement);
    root.render(React.createElement(App));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
} else {
    mount();
}
