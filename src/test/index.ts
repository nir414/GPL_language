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
import './gplParserDocComment.test';
import './docComment.test';
import './gplParserFixes.test';
import './consoleCommandClassifier.test';
import './indentationRules.test';
import './projectSelection.test';
import './projectPicker.test';
import './gprSync.test';
import './overloadResolution.test';
import './showVariableParser.test';
import './symbolCache.test';
import './renameCore.test';
import './deployLock.test';
import './trafficResponseBody.test';
import './deployRecord.test';
import './ftpRefreshThrottle.test';
import './ftpClient.test';
import './runtimeConsoleGuards.test';
import './keepAlive1402.test';
import './reachability.test';
import './resourceProbes.test';
import './stepGate.test';
import './threadLock.test';
import './threadActivity.test';
import './sourceTargets.test';
import './startCommand.test';
import './launchJsonc.test';
import './receiverType.test';
import './connectionHealth.test';
import './idlePing.test';
import './commandPolicy.test';
import './uriDispatch.test';
import './agentBridge.test';
import './projectNameGuard.test';
import './projectSources.test';
import './syncManifest.test';
import { run } from './harness';

void run();
