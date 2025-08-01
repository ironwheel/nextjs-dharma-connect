declare module 'react-srcdoc-iframe' {
    import React from 'react';

    interface ReactSrcDocIframeProps {
        srcDoc: string;
        [key: string]: any;
    }

    const ReactSrcDocIframe: React.FC<ReactSrcDocIframeProps>;
    export default ReactSrcDocIframe;
} 