import { runExecutivePresenterConformance } from '../../conformance/executive-presenter.js';
import { FakeExecutivePresenter } from './fake-executive-presenter.js';

runExecutivePresenterConformance(() => new FakeExecutivePresenter());
