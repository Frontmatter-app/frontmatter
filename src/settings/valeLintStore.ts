import { create } from 'zustand';
import type { ValeAlert } from '../types';

interface ValeLintState {
  alerts: Record<string, ValeAlert[]>;
  setAlerts: (alerts: Record<string, ValeAlert[]>) => void;
  clearAlerts: () => void;
}

export const useValeLintStore = create<ValeLintState>((set) => ({
  alerts: {},
  setAlerts: (alerts) => set({ alerts }),
  clearAlerts: () => set({ alerts: {} }),
}));
