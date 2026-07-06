import { useState, useEffect } from 'react';
import * as Y from 'yjs';

export function useWordCount(ydoc: Y.Doc | null) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!ydoc) {
      setCount(0);
      return;
    }
    
    const ytext = ydoc.getText('markdown');
    
    const update = () => {
      const text = ytext.toString();
      const count = text.trim() ? text.trim().split(/\s+/).length : 0;
      setCount(count);
    };

    update();
    ytext.observe(update);
    
    return () => {
      ytext.unobserve(update);
    };
  }, [ydoc]);

  return count;
}
