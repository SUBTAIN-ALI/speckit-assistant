import { useState, useEffect } from 'react';

export function useSidebar() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('isSidebarCollapsed');
      if (saved === 'true') {
        setIsSidebarCollapsed(true);
      }
    }
  }, []);

  const handleToggleSidebar = () => {
    setIsSidebarCollapsed(prev => {
      const nextVal = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('isSidebarCollapsed', String(nextVal));
      }
      return nextVal;
    });
  };

  return { isSidebarCollapsed, handleToggleSidebar } as const;
}
