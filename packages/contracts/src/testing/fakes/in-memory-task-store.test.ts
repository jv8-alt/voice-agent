import { runTaskStoreConformance } from '../../conformance/task-store.js';
import { InMemoryFakeTaskStore } from './in-memory-task-store.js';

runTaskStoreConformance(() => new InMemoryFakeTaskStore());
