import { runTaskEventLogConformance } from '../../conformance/task-event-log.js';
import { InMemoryFakeTaskEventLog } from './in-memory-task-event-log.js';

runTaskEventLogConformance(() => new InMemoryFakeTaskEventLog());
