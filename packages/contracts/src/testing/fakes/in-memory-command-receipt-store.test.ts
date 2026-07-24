import { runCommandReceiptStoreConformance } from '../../conformance/command-receipt-store.js';
import { InMemoryFakeCommandReceiptStore } from './in-memory-command-receipt-store.js';

runCommandReceiptStoreConformance(() => new InMemoryFakeCommandReceiptStore());
