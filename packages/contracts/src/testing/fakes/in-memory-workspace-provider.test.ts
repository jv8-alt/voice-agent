import { runWorkspaceProviderConformance } from '../../conformance/workspace-provider.js';
import { InMemoryFakeWorkspaceProvider } from './in-memory-workspace-provider.js';

runWorkspaceProviderConformance(() => new InMemoryFakeWorkspaceProvider());
