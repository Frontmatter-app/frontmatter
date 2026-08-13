import React, { createContext, useContext } from 'react';
import { firestorePorts } from './firestore/adapters';
import type { DataPorts } from './ports';

const DataContext = createContext<DataPorts>(firestorePorts);

/**
 * Supplies the data ports to the tree.
 *
 * Defaults to the Firestore adapters, so the app needs no extra wiring. Tests
 * pass `createFakePorts()` to render a component against in-memory data.
 */
export function DataProvider({
  ports = firestorePorts,
  children,
}: {
  ports?: DataPorts;
  children: React.ReactNode;
}) {
  return <DataContext.Provider value={ports}>{children}</DataContext.Provider>;
}

/** The data boundary. Components call this instead of importing Firestore. */
export function useData(): DataPorts {
  return useContext(DataContext);
}
