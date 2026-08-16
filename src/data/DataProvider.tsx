import React, { createContext, useContext } from 'react';
import { createFakePorts } from './fakes';
import type { DataPorts } from './ports';

const defaultPorts = createFakePorts();

const DataContext = createContext<DataPorts>(defaultPorts);

/**
 * Supplies the data ports to the tree.
 *
 * These ports described teams, invites, agreements and cloud documents in
 * Firestore. All four move to the git repository, so the runtime adapter is
 * gone and the in-memory implementation is what remains — the same one the
 * tests have always used.
 *
 * The port definitions are kept rather than deleted: they are the shape the
 * repository-backed adapters will implement.
 */
export function DataProvider({
  ports = defaultPorts,
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
