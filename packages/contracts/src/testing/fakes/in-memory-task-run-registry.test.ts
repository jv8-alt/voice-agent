import { runTaskRunRegistryConformance } from '../../conformance/task-run-registry.js';
import { InMemoryFakeTaskRunRegistry } from './in-memory-task-run-registry.js';

runTaskRunRegistryConformance(() => new InMemoryFakeTaskRunRegistry());
