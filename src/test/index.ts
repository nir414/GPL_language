/**
 * 순수 모듈 단위 테스트 진입점.
 *
 * 각 *.test 모듈을 import하면 harness에 케이스가 등록되고, run()이 실행한다.
 * 새 테스트 파일을 추가하면 여기에 import 한 줄을 더한다.
 */
import './cursorExpression.test';
import './responseParser.test';
import './controllerStatusCodes.test';
import './gplDictionaryData.test';
import './consoleCommandClassifier.test';
import './indentationRules.test';
import './projectSelection.test';
import { run } from './harness';

void run();
