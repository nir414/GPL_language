import type { GPLBuiltinEntry } from './gplBuiltins';

/**
 * Brooks GPL Dictionary(모션/로봇/위치/프로파일/기준프레임/래치/신호 클래스) 검증 데이터.
 *
 * 각 항목의 시그니처/요약은 GPL Dictionary 공식 문서 페이지에서 직접 확인했으며
 * `sourceUrl`은 그 페이지를 가리킨다. 추측 항목은 포함하지 않는다.
 *
 * 데이터 갱신 시 출처:
 *   https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/
 *
 * 주의: Location/Profile/RefFrame/Latch 멤버는 실제 코드에서 인스턴스 변수
 * (예: `pickLoc.X`)로 접근하지만, 문서 표기를 따라 `Class.Member` 형식으로 등록한다.
 * (Move/Robot/Signal은 정적 클래스라 표기 그대로 호출된다.)
 */
export const GPL_DICTIONARY_ENTRIES: GPLBuiltinEntry[] = [
    // ── Move Class ──────────────────────────────────────────────────────────
    {
        name: 'Move.Approach',
        kind: 'method',
        signature: 'Move.Approach(location, profile)',
        summary: '지정한 위치로 접근하기 전에, 위치 제어 협조 동작으로 클리어런스 위치까지 로봇을 이동시킵니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Approach(${1:location}, ${2:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/approach.htm'
    },
    {
        name: 'Move.Arc',
        kind: 'method',
        signature: 'Move.Arc(location1, location2, profile)',
        summary: '세 개의 위치 점으로 정의되는 원호 경로를 따라 로봇의 툴 팁을 이동시킵니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Arc(${1:location1}, ${2:location2}, ${3:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/arc.htm'
    },
    {
        name: 'Move.Circle',
        kind: 'method',
        signature: 'Move.Circle(location1, location2, profile)',
        summary: '세 개의 Location 값으로 정의되는 완전한 원을 따라 로봇의 툴 팁을 이동시킵니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Circle(${1:location1}, ${2:location2}, ${3:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/circle.htm'
    },
    {
        name: 'Move.Delay',
        kind: 'method',
        signature: 'Move.Delay(seconds)',
        summary: '지정한 시간(초) 동안 로봇 동작의 실행을 일시 정지합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Delay(${1:seconds})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/delay.htm'
    },
    {
        name: 'Move.Extra',
        kind: 'method',
        signature: 'Move.Extra(axis1, axis2, axis3, axis4)',
        summary: '다음 직교 좌표 Location 동작 중에 독립적인 추가 축들을 지정한 위치로 이동시킵니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Extra(${1:axis1}, ${2:axis2}, ${3:axis3}, ${4:axis4})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/extra.htm'
    },
    {
        name: 'Move.ForceOverlap',
        kind: 'method',
        signature: 'Move.ForceOverlap(mode, criterion)',
        summary: '시스템의 기본 동작 블렌딩 기능을 우회하여, 연속된 두 동작이 어떻게 겹쳐 실행될지를 정의합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.ForceOverlap(${1:mode}, ${2:criterion})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/forceoverlap.htm'
    },
    {
        name: 'Move.SetJogCommand',
        kind: 'method',
        signature: 'Move.SetJogCommand(jogMode, jogAxis, jogSpeed)',
        summary: '조그(수동) 제어 모드에서 사용할 모드, 축, 속도를 설정하거나 변경합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.SetJogCommand(${1:jogMode}, ${2:jogAxis}, ${3:jogSpeed})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/jogcommand.htm'
    },
    {
        name: 'Move.Loc',
        kind: 'method',
        signature: 'Move.Loc(location, profile)',
        summary: '위치 제어 동작으로 로봇을 지정한 목적지로 이동시키는 기본 메서드입니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Loc(${1:location}, ${2:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/loc.htm'
    },
    {
        name: 'Move.OneAxis',
        kind: 'method',
        signature: 'Move.OneAxis(axis, position, relativeFlag, profile)',
        summary: '로봇의 단일 축을 이동시키는 편의 메서드입니다.',
        category: 'Move Class',
        insertSnippet: 'Move.OneAxis(${1:axis}, ${2:position}, ${3:relativeFlag}, ${4:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/oneaxis.htm'
    },
    {
        name: 'Move.Rel',
        kind: 'method',
        signature: 'Move.Rel(location, profile)',
        summary: '이전 동작의 최종 위치로부터의 증분 오프셋으로 계산된 목적지로 모든 로봇 축을 이동시킵니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Rel(${1:location}, ${2:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/rel.htm'
    },
    {
        name: 'Move.SetRealTimeMod',
        kind: 'method',
        signature: 'Move.SetRealTimeMod(changesArray)',
        summary: '실시간 궤적 수정(Real-time Trajectory Modification) 모드에서의 위치/자세 증분 변화량을 설정합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.SetRealTimeMod(${1:changesArray})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/setrtmod.htm'
    },
    {
        name: 'Move.SetSpeeds',
        kind: 'method',
        signature: 'Move.SetSpeeds(speedArray, profile)',
        summary: '속도 제어 모드로 동작 중인 로봇의 모든 축에 대해 새로운 목표 속도를 설정합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.SetSpeeds(${1:speedArray}, ${2:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/setspeeds.htm'
    },
    {
        name: 'Move.SetTorques',
        kind: 'method',
        signature: 'Move.SetTorques(torquesArray)',
        summary: '토크 제어 모드에서 모든 모터에 대해 새로운 목표 토크 출력 레벨을 설정합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.SetTorques(${1:torquesArray})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/settorques.htm'
    },
    {
        name: 'Move.StartJogMode',
        kind: 'method',
        signature: 'Move.StartJogMode()',
        summary: '조그(수동) 제어 모드의 실행을 시작합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.StartJogMode()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/startjogmode.htm'
    },
    {
        name: 'Move.StartRealTimeMod',
        kind: 'method',
        signature: 'Move.StartRealTimeMod(coordinates, changeType)',
        summary: '실행 중인 계획 경로의 위치와 자세를 프로그램이 실시간으로 증분 수정할 수 있게 하는 특수 궤적 모드를 시작합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.StartRealTimeMod(${1:coordinates}, ${2:changeType})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/startrtmod.htm'
    },
    {
        name: 'Move.StartSpeedDAC',
        kind: 'method',
        signature: 'Move.StartSpeedDAC(mode, nSegments, speedArray, dacArray)',
        summary: '로봇의 순간 툴 팁 속도를 기준으로 값이 계산되는 아날로그 출력 채널(DAC)의 자동 제어를 시작/변경/중지합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.StartSpeedDAC(${1:mode}, ${2:nSegments}, ${3:speedArray}, ${4:dacArray})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/startspeeddac.htm'
    },
    {
        name: 'Move.StartTorqueCntrl',
        kind: 'method',
        signature: 'Move.StartTorqueCntrl(motorMask, adcMask, torquesArray)',
        summary: '하나 이상의 모터에 대해 토크 제어 모드의 실행을 시작합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.StartTorqueCntrl(${1:motorMask}, ${2:adcMask}, ${3:torquesArray})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/starttorquecntrl.htm'
    },
    {
        name: 'Move.StartVelocityCntrl',
        kind: 'method',
        signature: 'Move.StartVelocityCntrl(mode, adcMask, speedsArray, profile)',
        summary: '로봇의 모든 축을 위치 제어에서 속도 제어 모드로 전환합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.StartVelocityCntrl(${1:mode}, ${2:adcMask}, ${3:speedsArray}, ${4:profile})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/startvelocitycntrl.htm'
    },
    {
        name: 'Move.StopSpecialModes',
        kind: 'method',
        signature: 'Move.StopSpecialModes',
        summary: '활성화된 모든 특수 궤적 제어 모드의 실행을 종료합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.StopSpecialModes',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/stopspecialmodes.htm'
    },
    {
        name: 'Move.Trigger',
        kind: 'method',
        signature: 'Move.Trigger(mode, triggerPt, channel)',
        summary: '다음 또는 현재 동작 중 지정한 트리거 위치에서 디지털 출력 신호 또는 스레드 이벤트를 자동 발생시키도록 준비합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.Trigger(${1:mode}, ${2:triggerPt}, ${3:channel})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/trigger.htm'
    },
    {
        name: 'Move.WaitForEOM',
        kind: 'method',
        signature: 'Move.WaitForEOM',
        summary: '로봇이 현재 동작을 완료할 때까지 현재 스레드의 실행을 일시 중단합니다.',
        category: 'Move Class',
        insertSnippet: 'Move.WaitForEOM',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/waitforoem.htm'
    },

    // ── Robot Class ─────────────────────────────────────────────────────────
    {
        name: 'Robot.Attached',
        kind: 'property',
        signature: 'Robot.Attached',
        summary: '스레드가 독점적으로 제어하는 로봇 번호를 설정하거나 가져옵니다.',
        category: 'Robot Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/attached.htm'
    },
    {
        name: 'Robot.Base',
        kind: 'property',
        signature: 'Robot.Base(robot)',
        summary: '로봇 베이스에 대한 직교 좌표 위치 오프셋을 설정하거나 가져옵니다.',
        category: 'Robot Class',
        returnType: 'Location',
        insertSnippet: 'Robot.Base(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/base.htm'
    },
    {
        name: 'Robot.CartMode',
        kind: 'property',
        signature: 'Robot.CartMode(robot)',
        summary: '특수 직교 궤적 모드의 활성 여부를 나타내는 플래그 비트를 담은 정수를 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.CartMode(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/cartmode.htm'
    },
    {
        name: 'Robot.Custom',
        kind: 'property',
        signature: 'Robot.Custom(robot, index)',
        summary: '사용자 정의 운동학 매개변수 배열의 지정한 요소 값을 설정하거나 가져옵니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.Custom(${1:robot}, ${2:index})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/custom.htm'
    },
    {
        name: 'Robot.DefLinComp',
        kind: 'method',
        signature: 'Robot.DefLinComp(robot, motor, encStart, encStep, numCor, cor)',
        summary: '지정한 모터에 대한 선형 보정 테이블을 인코더 카운트 단위로 정의합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.DefLinComp(${1:robot}, ${2:motor}, ${3:encStart}, ${4:encStep}, ${5:numCor}, ${6:cor})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/deflincomp.htm'
    },
    {
        name: 'Robot.Dest',
        kind: 'property',
        signature: 'Robot.Dest(robot)',
        summary: '이전에 실행한 동작의 원래 계획된 최종 목적지를 직교 좌표 위치로 반환합니다.',
        category: 'Robot Class',
        returnType: 'Location',
        insertSnippet: 'Robot.Dest(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/dest.htm'
    },
    {
        name: 'Robot.DestAngles',
        kind: 'property',
        signature: 'Robot.DestAngles(robot)',
        summary: '이전에 실행한 동작의 원래 계획된 최종 목적지를 각도 위치로 반환합니다.',
        category: 'Robot Class',
        returnType: 'Location',
        insertSnippet: 'Robot.DestAngles(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/destangles.htm'
    },
    {
        name: 'Robot.Home',
        kind: 'method',
        signature: 'Robot.Home',
        summary: '현재 선택된 로봇을 호밍하여 축의 기준 위치를 설정합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.Home',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/home.htm'
    },
    {
        name: 'Robot.HomeAll',
        kind: 'method',
        signature: 'Robot.HomeAll',
        summary: '모든 로봇을 호밍하여 각 축의 기준 위치를 설정합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.HomeAll',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/homeall.htm'
    },
    {
        name: 'Robot.JointToMotor',
        kind: 'method',
        signature: 'Robot.JointToMotor(robot, jointPos, motorPos)',
        summary: '축 관절 위치 값을 모터 인코더 위치 값으로 변환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.JointToMotor(${1:robot}, ${2:jointPos}, ${3:motorPos})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/jointtomotor.htm'
    },
    {
        name: 'Robot.LastProfile',
        kind: 'property',
        signature: 'Robot.LastProfile(robot)',
        summary: '마지막으로 실행된 동작의 프로파일 정보를 반환합니다.',
        category: 'Robot Class',
        returnType: 'Profile',
        insertSnippet: 'Robot.LastProfile(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/lastprofile.htm'
    },
    {
        name: 'Robot.MotorTempStatus',
        kind: 'property',
        signature: 'Robot.MotorTempStatus(robot, motor)',
        summary: '지정한 모터의 온도 상태를 나타내는 정수 값을 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.MotorTempStatus(${1:robot}, ${2:motor})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/motortempstatus.htm'
    },
    {
        name: 'Robot.MotorToJoint',
        kind: 'method',
        signature: 'Robot.MotorToJoint(robot, motorPos, jointPos)',
        summary: '모터 인코더 위치 값을 축 관절 위치 값으로 변환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.MotorToJoint(${1:robot}, ${2:motorPos}, ${3:jointPos})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/motortojoint.htm'
    },
    {
        name: 'Robot.Source',
        kind: 'property',
        signature: 'Robot.Source(robot)',
        summary: '이전에 실행한 동작의 시작 위치를 직교 좌표 위치로 반환합니다.',
        category: 'Robot Class',
        returnType: 'Location',
        insertSnippet: 'Robot.Source(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/origin.htm'
    },
    {
        name: 'Robot.SourceAngles',
        kind: 'property',
        signature: 'Robot.SourceAngles(robot)',
        summary: '이전에 실행한 동작의 시작 위치를 각도 위치로 반환합니다.',
        category: 'Robot Class',
        returnType: 'Location',
        insertSnippet: 'Robot.SourceAngles(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/originangles.htm'
    },
    {
        name: 'Robot.Payload',
        kind: 'property',
        signature: 'Robot.Payload(robot)',
        summary: '최대 용량 대비 백분율로 표현되는 페이로드 질량을 설정하거나 가져옵니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.Payload(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/payload.htm'
    },
    {
        name: 'Robot.RapidDecel',
        kind: 'property',
        signature: 'Robot.RapidDecel(robot)',
        summary: '로봇의 급속 감속 설정 값을 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.RapidDecel(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/rapiddecel.htm'
    },
    {
        name: 'Robot.RestartBase',
        kind: 'property',
        signature: 'Robot.RestartBase(robot)',
        summary: '컨트롤러 재시작 시 설정되었던 베이스 오프셋을 반환합니다.',
        category: 'Robot Class',
        returnType: 'Location',
        insertSnippet: 'Robot.RestartBase(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/restartbase.htm'
    },
    {
        name: 'Robot.RestartTool',
        kind: 'property',
        signature: 'Robot.RestartTool(robot)',
        summary: '컨트롤러 재시작 시 설정되었던 툴/그리퍼의 위치 및 방향 오프셋을 반환합니다.',
        category: 'Robot Class',
        returnType: 'Location',
        insertSnippet: 'Robot.RestartTool(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/restarttool.htm'
    },
    {
        name: 'Robot.RealTimeModAcm',
        kind: 'property',
        signature: 'Robot.RealTimeModAcm(robot)',
        summary: '실시간 궤적 수정 모드로 생성된 누적 경로 수정량을 직교 좌표 위치로 반환합니다.',
        category: 'Robot Class',
        returnType: 'Location',
        insertSnippet: 'Robot.RealTimeModAcm(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/rtmodaccum.htm'
    },
    {
        name: 'Robot.Selected',
        kind: 'property',
        signature: 'Robot.Selected',
        summary: '특정 로봇 접근 시 사용할 기본 로봇 번호를 설정하거나 가져옵니다.',
        category: 'Robot Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/selected.htm'
    },
    {
        name: 'Robot.SpeedAngles',
        kind: 'property',
        signature: 'Robot.SpeedAngles(robot)',
        summary: '로봇 각 축의 속도 정보를 각도 위치 객체로 반환합니다.',
        category: 'Robot Class',
        returnType: 'Location',
        insertSnippet: 'Robot.SpeedAngles(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/speedangles.htm'
    },
    {
        name: 'Robot.Tool',
        kind: 'property',
        signature: 'Robot.Tool(robot)',
        summary: '로봇 툴/그리퍼의 위치 및 방향 오프셋을 설정하거나 가져옵니다.',
        category: 'Robot Class',
        returnType: 'Location',
        insertSnippet: 'Robot.Tool(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/tool.htm'
    },
    {
        name: 'Robot.TrajState',
        kind: 'property',
        signature: 'Robot.TrajState(robot, mode)',
        summary: '지정한 모드에 따라 로봇 궤적 상태 정보를 반환합니다.',
        category: 'Robot Class',
        insertSnippet: 'Robot.TrajState(${1:robot}, ${2:mode})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/trajstate.htm'
    },
    {
        name: 'Robot.Where',
        kind: 'property',
        signature: 'Robot.Where(robot)',
        summary: '베이스와 툴 오프셋을 반영한 로봇의 현재 위치와 방향을 직교 좌표 위치로 반환합니다.',
        category: 'Robot Class',
        returnType: 'Location',
        insertSnippet: 'Robot.Where(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/where.htm'
    },
    {
        name: 'Robot.WhereAngles',
        kind: 'property',
        signature: 'Robot.WhereAngles(robot)',
        summary: '각 모터의 순간 인코더 값을 읽어 로봇의 현재 축 위치를 각도 위치로 반환합니다.',
        category: 'Robot Class',
        returnType: 'Location',
        insertSnippet: 'Robot.WhereAngles(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/whereangles.htm'
    },

    // ── Location Class (인스턴스 멤버, 문서 표기 기준) ─────────────────────────
    {
        name: 'Location.Angle',
        kind: 'property',
        signature: 'Location.Angle(axis)',
        summary: 'Angles 위치 객체에서 지정한 축(1~12)의 위치 값을 mm 또는 도 단위로 읽거나 설정합니다.',
        category: 'Location Class',
        insertSnippet: 'Angle(${1:axis})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/angle.htm'
    },
    {
        name: 'Location.Angles',
        kind: 'method',
        signature: 'Location.Angles(axis1, ..., axis12)',
        summary: 'Angles 위치 객체의 모든 축 위치 값을 최대 12개의 인수로 한 번에 설정합니다.',
        category: 'Location Class',
        insertSnippet: 'Angles(${1:axis1}, ${2:axis2})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/angles.htm'
    },
    {
        name: 'Location.Clone',
        kind: 'method',
        signature: 'Location.Clone',
        summary: 'Location 객체의 독립적인 복사본을 생성하여 반환합니다.',
        category: 'Location Class',
        returnType: 'Location',
        insertSnippet: 'Clone',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/clone.htm'
    },
    {
        name: 'Location.Config',
        kind: 'property',
        signature: 'Location.Config',
        summary: '데카르트 위치를 축 위치 값으로 변환하는 방식을 제어하는 정수 비트마스크를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/config.htm'
    },
    {
        name: 'Location.ConveyorLimit',
        kind: 'method',
        signature: 'Location.ConveyorLimit(mode)',
        summary: '컨베이어 기준 프레임에 정의된 Location이 컨베이어 벨트 동작 한계로부터 떨어진 거리를 반환합니다.',
        category: 'Location Class',
        insertSnippet: 'ConveyorLimit(${1:mode})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/conveyorlimits.htm'
    },
    {
        name: 'Location.Distance',
        kind: 'method',
        signature: 'Location.Distance(location1, location2)',
        summary: '두 데카르트 위치 객체의 XYZ 위치 사이 거리를 Double 값으로 계산하여 반환합니다.',
        category: 'Location Class',
        insertSnippet: 'Location.Distance(${1:location1}, ${2:location2})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/distance.htm'
    },
    {
        name: 'Location.Here',
        kind: 'method',
        signature: 'Location.Here',
        summary: '선택된 로봇의 현재 위치와 방향을 Location 객체의 전체 위치 값으로 설정합니다.',
        category: 'Location Class',
        insertSnippet: 'Here',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/here.htm'
    },
    {
        name: 'Location.Here3',
        kind: 'method',
        signature: 'Location.Here3(location0, locationX, locationY)',
        summary: '세 개의 데카르트 위치 객체의 XYZ 좌표를 사용해 Location 객체의 위치와 방향을 정의합니다.',
        category: 'Location Class',
        insertSnippet: 'Here3(${1:location0}, ${2:locationX}, ${3:locationY})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/here3.htm'
    },
    {
        name: 'Location.Inverse',
        kind: 'method',
        signature: 'Location.Inverse',
        summary: '데카르트 위치 객체의 전체 위치 값에 대한 역변환을 반환합니다.',
        category: 'Location Class',
        returnType: 'Location',
        insertSnippet: 'Inverse',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/inverse.htm'
    },
    {
        name: 'Location.KineSol',
        kind: 'method',
        signature: 'Location.KineSol(mode, location)',
        summary: '특정 운동학 모델에 대해 Angles 위치 객체와 동등한 데카르트 위치 객체를 반환하거나 그 반대로 변환합니다.',
        category: 'Location Class',
        returnType: 'Location',
        insertSnippet: 'KineSol(${1:mode}, ${2:location})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/kinesol.htm'
    },
    {
        name: 'Location.Mul',
        kind: 'method',
        signature: 'Location.Mul(location2)',
        summary: '한 데카르트 위치 객체의 위치와 방향을 다른 위치 객체와 결합한 변환 결과를 반환합니다.',
        category: 'Location Class',
        returnType: 'Location',
        insertSnippet: 'Mul(${1:location2})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/mul.htm'
    },
    {
        name: 'Location.Normalize',
        kind: 'method',
        signature: 'Location.Normalize',
        summary: '데카르트 위치 객체의 PosWrtRef 값에 누적된 수학적 불일치를 보정합니다.',
        category: 'Location Class',
        insertSnippet: 'Normalize',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/normalize.htm'
    },
    {
        name: 'Location.Pitch',
        kind: 'property',
        signature: 'Location.Pitch',
        summary: '데카르트 위치 객체 PosWrtRef 값의 Pitch 각도(도)를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/pitch.htm'
    },
    {
        name: 'Location.Pos',
        kind: 'property',
        signature: 'Location.Pos',
        summary: 'Location 객체의 전체 위치 값을 읽거나 설정합니다.',
        category: 'Location Class',
        returnType: 'Location',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/pos.htm'
    },
    {
        name: 'Location.PosWrtRef',
        kind: 'property',
        signature: 'Location.PosWrtRef',
        summary: '기준 프레임 데이터를 무시한 채 데카르트 위치 객체의 기준 프레임 기준 위치 값을 읽거나 설정합니다.',
        category: 'Location Class',
        returnType: 'Location',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/poswrtref.htm'
    },
    {
        name: 'Location.RefFrame',
        kind: 'property',
        signature: 'Location.RefFrame',
        summary: 'Location 객체의 위치와 방향이 정의되는 기준 프레임 객체에 대한 포인터를 읽거나 설정합니다.',
        category: 'Location Class',
        returnType: 'RefFrame',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/refframe.htm'
    },
    {
        name: 'Location.Roll',
        kind: 'property',
        signature: 'Location.Roll',
        summary: '데카르트 위치 객체 PosWrtRef 값의 Roll 각도(도)를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/roll.htm'
    },
    {
        name: 'Location.Text',
        kind: 'property',
        signature: 'Location.Text',
        summary: 'Location 객체에 연결된 임의의 문자열 값을 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/text.htm'
    },
    {
        name: 'Location.Type',
        kind: 'property',
        signature: 'Location.Type',
        summary: 'Location 객체가 데카르트(0) 또는 Angles(1) 데이터를 담는지 나타내는 정수 값을 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/type.htm'
    },
    {
        name: 'Location.X',
        kind: 'property',
        signature: 'Location.X',
        summary: '데카르트 위치 객체 PosWrtRef 값의 X축 변위(mm)를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/x.htm'
    },
    {
        name: 'Location.XYZ',
        kind: 'method',
        signature: 'Location.XYZ(x, y, z, yaw, pitch, roll)',
        summary: '데카르트 위치 객체의 X, Y, Z, Yaw, Pitch, Roll 좌표를 한 번에 설정합니다.',
        category: 'Location Class',
        insertSnippet: 'XYZ(${1:x}, ${2:y}, ${3:z}, ${4:yaw}, ${5:pitch}, ${6:roll})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/xyz.htm'
    },
    {
        name: 'Location.XYZInc',
        kind: 'method',
        signature: 'Location.XYZInc(x, y, z)',
        summary: '데카르트 위치 객체 PosWrtRef 값의 X, Y, Z 변위 성분을 증분합니다.',
        category: 'Location Class',
        insertSnippet: 'XYZInc(${1:x}, ${2:y}, ${3:z})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/xyzinc.htm'
    },
    {
        name: 'Location.XYZValue',
        kind: 'method',
        signature: 'Location.XYZValue(x, y, z, yaw, pitch, roll)',
        summary: '지정한 X, Y, Z, Yaw, Pitch, Roll 좌표와 동일한 전체 위치를 가진 데카르트 Location을 반환합니다.',
        category: 'Location Class',
        returnType: 'Location',
        insertSnippet: 'Location.XYZValue(${1:x}, ${2:y}, ${3:z}, ${4:yaw}, ${5:pitch}, ${6:roll})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/xyzvalue.htm'
    },
    {
        name: 'Location.Y',
        kind: 'property',
        signature: 'Location.Y',
        summary: '데카르트 위치 객체 PosWrtRef 값의 Y축 변위(mm)를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/y.htm'
    },
    {
        name: 'Location.Yaw',
        kind: 'property',
        signature: 'Location.Yaw',
        summary: '데카르트 위치 객체 PosWrtRef 값의 Yaw 각도(도)를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/yaw.htm'
    },
    {
        name: 'Location.Z',
        kind: 'property',
        signature: 'Location.Z',
        summary: '데카르트 위치 객체 PosWrtRef 값의 Z축 변위(mm)를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/z.htm'
    },
    {
        name: 'Location.ZClearance',
        kind: 'property',
        signature: 'Location.ZClearance',
        summary: 'Location 객체로의 안전 접근 위치를 정의하는 Z축 방향 거리(mm)를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/zclearance.htm'
    },
    {
        name: 'Location.ZWorld',
        kind: 'property',
        signature: 'Location.ZWorld',
        summary: 'ZClearance 거리를 월드 Z축 기준으로 해석할지 툴 Z축 기준으로 해석할지를 결정하는 Boolean 플래그를 읽거나 설정합니다.',
        category: 'Location Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/zworld.htm'
    },

    // ── Profile Class (인스턴스 멤버, 문서 표기 기준) ──────────────────────────
    {
        name: 'Profile.Accel',
        kind: 'property',
        signature: 'Profile.Accel',
        summary: '모션 프로파일의 가속도 값을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/accel.htm'
    },
    {
        name: 'Profile.AccelRamp',
        kind: 'property',
        signature: 'Profile.AccelRamp',
        summary: '프로파일의 가속 램프(저크 제한) 시간을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/accelramp.htm'
    },
    {
        name: 'Profile.Decel',
        kind: 'property',
        signature: 'Profile.Decel',
        summary: '모션 프로파일의 감속도 값을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/decel.htm'
    },
    {
        name: 'Profile.DecelRamp',
        kind: 'property',
        signature: 'Profile.DecelRamp',
        summary: '프로파일의 감속 램프(저크 제한) 시간을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/decelramp.htm'
    },
    {
        name: 'Profile.InRange',
        kind: 'property',
        signature: 'Profile.InRange',
        summary: '모션 종료 시 목표 위치 도달 정밀도(인레인지) 조건을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/inrange.htm'
    },
    {
        name: 'Profile.Speed',
        kind: 'property',
        signature: 'Profile.Speed',
        summary: '모션 프로파일의 속도 값을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/speed_property.htm'
    },
    {
        name: 'Profile.Speed2',
        kind: 'property',
        signature: 'Profile.Speed2',
        summary: '모션의 두 번째(보조) 속도 값을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/speed2.htm'
    },
    {
        name: 'Profile.Straight',
        kind: 'property',
        signature: 'Profile.Straight',
        summary: '모션을 직선(스트레이트 라인) 경로로 수행할지 여부를 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/straight.htm'
    },
    {
        name: 'Profile.Text',
        kind: 'property',
        signature: 'Profile.Text',
        summary: '프로파일 객체에 연결된 설명용 문자열을 설정하거나 읽습니다.',
        category: 'Profile Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/pf_text.htm'
    },
    {
        name: 'Profile.Clone',
        kind: 'method',
        signature: 'Profile.Clone',
        summary: '현재 프로파일 객체의 복사본을 생성하여 반환합니다.',
        category: 'Profile Class',
        returnType: 'Profile',
        insertSnippet: 'Clone',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/profileclone.htm'
    },

    // ── Reference Frame Class (인스턴스 멤버, 문서 표기 기준) ───────────────────
    {
        name: 'RefFrame.ConveyorOffset',
        kind: 'property',
        signature: 'RefFrame.ConveyorOffset',
        summary: '컨베이어 추종 기준 프레임의 엔코더 오프셋 값을 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/conveyoroffset.htm'
    },
    {
        name: 'RefFrame.ConveyorRobot',
        kind: 'property',
        signature: 'RefFrame.ConveyorRobot',
        summary: '컨베이어 기준 프레임이 연결될 로봇 번호를 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/conveyorrobot.htm'
    },
    {
        name: 'RefFrame.PalletIndex',
        kind: 'property',
        signature: 'RefFrame.PalletIndex(rowColLay)',
        summary: '팔레트 기준 프레임의 지정 차원에 대한 현재 인덱스 값을 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        insertSnippet: 'PalletIndex(${1:rowColLay})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/palletindex.htm'
    },
    {
        name: 'RefFrame.PalletMaxIndex',
        kind: 'property',
        signature: 'RefFrame.PalletMaxIndex(rowColLay)',
        summary: '팔레트 기준 프레임의 지정 차원에 대한 최대 인덱스 값을 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        insertSnippet: 'PalletMaxIndex(${1:rowColLay})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/palletmaxindex.htm'
    },
    {
        name: 'RefFrame.PalletNextPos',
        kind: 'method',
        signature: 'RefFrame.PalletNextPos',
        summary: '팔레트 인덱스를 다음 위치로 진행시키고 해당 위치를 반환합니다.',
        category: 'Reference Frame Class',
        insertSnippet: 'PalletNextPos',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/palletnextpos.htm'
    },
    {
        name: 'RefFrame.PalletOrder',
        kind: 'property',
        signature: 'RefFrame.PalletOrder',
        summary: '팔레트 위치를 순회할 때의 인덱싱 순서를 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/palletorder.htm'
    },
    {
        name: 'RefFrame.PalletPitch',
        kind: 'property',
        signature: 'RefFrame.PalletPitch(rowColLay)',
        summary: '팔레트 기준 프레임의 지정 차원에 대한 셀 간 간격(피치)을 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        insertSnippet: 'PalletPitch(${1:rowColLay})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/palletpitch.htm'
    },
    {
        name: 'RefFrame.PalletRowColLay',
        kind: 'method',
        signature: 'RefFrame.PalletRowColLay(row, column, layer)',
        summary: '지정한 행·열·층 좌표에 해당하는 팔레트 셀 위치를 계산하여 반환합니다.',
        category: 'Reference Frame Class',
        insertSnippet: 'PalletRowColLay(${1:row}, ${2:column}, ${3:layer})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/palletrowcollay.htm'
    },
    {
        name: 'RefFrame.Loc',
        kind: 'property',
        signature: 'RefFrame.Loc',
        summary: '기준 프레임을 정의하는 직교 좌표 위치 객체를 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        returnType: 'Location',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/rf_loc.htm'
    },
    {
        name: 'RefFrame.Pos',
        kind: 'method',
        signature: 'RefFrame.Pos(location)',
        summary: '주어진 위치를 이 기준 프레임 기준으로 변환한 위치를 반환합니다.',
        category: 'Reference Frame Class',
        returnType: 'Location',
        insertSnippet: 'Pos(${1:location})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/rf_pos.htm'
    },
    {
        name: 'RefFrame.PosWrtRef',
        kind: 'method',
        signature: 'RefFrame.PosWrtRef(location)',
        summary: '주어진 위치를 이 기준 프레임의 참조 프레임 기준으로 표현한 위치를 반환합니다.',
        category: 'Reference Frame Class',
        returnType: 'Location',
        insertSnippet: 'PosWrtRef(${1:location})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/rf_poswrtref.htm'
    },
    {
        name: 'RefFrame.Text',
        kind: 'property',
        signature: 'RefFrame.Text',
        summary: '기준 프레임 객체에 연결된 설명용 문자열을 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/rf_text.htm'
    },
    {
        name: 'RefFrame.Type',
        kind: 'property',
        signature: 'RefFrame.Type',
        summary: '기준 프레임의 종류를 나타내는 정수 타입 값을 설정하거나 읽습니다.',
        category: 'Reference Frame Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/rf_type.htm'
    },

    // ── Latch Class (인스턴스/정적 혼합, 문서 표기 기준) ───────────────────────
    {
        name: 'Latch.Angle',
        kind: 'property',
        signature: 'Latch.Angle(axis)',
        summary: '래치 발생 시점에 캡처된 지정 축의 각도(위치) 값을 반환합니다.',
        category: 'Latch Class',
        insertSnippet: 'Angle(${1:axis})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_angle.htm'
    },
    {
        name: 'Latch.Count',
        kind: 'property',
        signature: 'Latch.Count(robot)',
        summary: '지정한 로봇에 대해 대기 중인 래치 데이터의 개수를 반환합니다.',
        category: 'Latch Class',
        insertSnippet: 'Latch.Count(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_count.htm'
    },
    {
        name: 'Latch.ErrorCode',
        kind: 'property',
        signature: 'Latch.ErrorCode',
        summary: '래치 동작과 관련된 오류 코드를 반환합니다.',
        category: 'Latch Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_errorcode.htm'
    },
    {
        name: 'Latch.Flush',
        kind: 'method',
        signature: 'Latch.Flush(robot)',
        summary: '지정한 로봇에 대해 대기 중인 모든 래치 데이터를 비웁니다.',
        category: 'Latch Class',
        insertSnippet: 'Latch.Flush(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_flush.htm'
    },
    {
        name: 'Latch.Location',
        kind: 'method',
        signature: 'Latch.Location(type)',
        summary: '래치 발생 시점에 캡처된 로봇 위치를 지정한 형식의 위치 객체로 반환합니다.',
        category: 'Latch Class',
        returnType: 'Location',
        insertSnippet: 'Location(${1:type})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_location.htm'
    },
    {
        name: 'Latch.RawTime',
        kind: 'property',
        signature: 'Latch.RawTime',
        summary: '래치 이벤트가 발생한 원시(raw) 타임스탬프 값을 반환합니다.',
        category: 'Latch Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_rawtime.htm'
    },
    {
        name: 'Latch.Result',
        kind: 'method',
        signature: 'Latch.Result(robot, noException)',
        summary: '지정한 로봇의 다음 래치 데이터를 가져와 래치 객체로 반환합니다.',
        category: 'Latch Class',
        returnType: 'Latch',
        insertSnippet: 'Latch.Result(${1:robot}, ${2:noException})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_result.htm'
    },
    {
        name: 'Latch.Signal',
        kind: 'property',
        signature: 'Latch.Signal',
        summary: '래치를 트리거한 신호 번호를 반환합니다.',
        category: 'Latch Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_signal.htm'
    },
    {
        name: 'Latch.ThreadEvent',
        kind: 'property',
        signature: 'Latch.ThreadEvent(robot)',
        summary: '지정한 로봇의 래치 이벤트 발생 시 스레드에 통지할 이벤트 마스크를 설정하거나 읽습니다.',
        category: 'Latch Class',
        insertSnippet: 'Latch.ThreadEvent(${1:robot})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_threadevent.htm'
    },
    {
        name: 'Latch.Timestamp',
        kind: 'property',
        signature: 'Latch.Timestamp(select)',
        summary: '래치 이벤트가 발생한 시각을 지정한 선택 기준에 따라 반환합니다.',
        category: 'Latch Class',
        insertSnippet: 'Timestamp(${1:select})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/lat_timestamp.htm'
    },

    // ── Signal Class ──────────────────────────────────────────────────────────
    {
        name: 'Signal.DIO',
        kind: 'property',
        signature: 'Signal.DIO(channel, count)',
        summary: '지정한 채널의 디지털 입출력 신호 값을 설정하거나 읽습니다.',
        category: 'Signal Class',
        insertSnippet: 'Signal.DIO(${1:channel}, ${2:count})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Signal/Dio.htm'
    },
    {
        name: 'Signal.AIO',
        kind: 'property',
        signature: 'Signal.AIO(channel)',
        summary: '지정한 채널의 아날로그 입출력 신호 값을 설정하거나 읽습니다.',
        category: 'Signal Class',
        insertSnippet: 'Signal.AIO(${1:channel})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Signal/Aio.htm'
    },

    // ── String Class (인스턴스 멤버/공유 메서드, 문서 표기 기준) ───────────────
    // 공식 "Strings and String Expressions Overview" Table 19-8 기준. 인스턴스 멤버는
    // 실제로 string 변수에 대해 호출되지만(예: name.Substring(0, 3)), 문서 표기를 따라
    // String.Member 형식으로 등록한다. (String.Compare만 공유(shared) 메서드)
    {
        name: 'String.Compare',
        kind: 'method',
        signature: 'String.Compare(string_a, string_b, ignore_case)',
        summary: '두 문자열을 대소문자 구분 또는 무시하여 비교하고 결과를 정수로 반환합니다. (shared 메서드)',
        category: 'String Class',
        insertSnippet: 'String.Compare(${1:string_a}, ${2:string_b}, ${3:ignore_case})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/compare.htm'
    },
    {
        name: 'String.IndexOf',
        kind: 'method',
        signature: 'string.IndexOf(string_s, start)',
        summary: '문자열 인스턴스에서 부분 문자열을 검색해 일치하면 시작 위치(0~n)를 반환합니다.',
        category: 'String Class',
        insertSnippet: 'IndexOf(${1:string_s}, ${2:start})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/indexof.htm'
    },
    {
        name: 'String.Length',
        kind: 'property',
        signature: 'string.Length',
        summary: '문자열의 문자 개수를 반환합니다.',
        category: 'String Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/length.htm'
    },
    {
        name: 'String.Split',
        kind: 'method',
        signature: 'string.Split(separator_string)',
        summary: '지정한 구분 문자를 기준으로 문자열을 나눠 부분 문자열 배열로 반환합니다.',
        category: 'String Class',
        insertSnippet: 'Split(${1:separator_string})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/split.htm'
    },
    {
        name: 'String.Substring',
        kind: 'method',
        signature: 'string.Substring(first_pos, length)',
        summary: '지정한 시작 위치(first_pos)부터 length 개수만큼의 부분 문자열을 반환합니다.',
        category: 'String Class',
        insertSnippet: 'Substring(${1:first_pos}, ${2:length})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/substring.htm'
    },
    {
        name: 'String.ToLower',
        kind: 'method',
        signature: 'string.ToLower',
        summary: '모든 문자를 소문자로 바꾼 복사본을 반환합니다.',
        category: 'String Class',
        insertSnippet: 'ToLower',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/tolower.htm'
    },
    {
        name: 'String.ToUpper',
        kind: 'method',
        signature: 'string.ToUpper',
        summary: '모든 문자를 대문자로 바꾼 복사본을 반환합니다.',
        category: 'String Class',
        insertSnippet: 'ToUpper',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/toupper.htm'
    },
    {
        name: 'String.TrimEnd',
        kind: 'method',
        signature: 'string.TrimEnd',
        summary: '문자열 끝쪽의 공백(또는 지정 문자)을 제거한 새 문자열을 반환합니다.',
        category: 'String Class',
        insertSnippet: 'TrimEnd',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/trimend.htm'
    },
    {
        name: 'String.TrimStart',
        kind: 'method',
        signature: 'string.TrimStart',
        summary: '문자열 앞쪽의 공백(또는 지정 문자)을 제거한 새 문자열을 반환합니다.',
        category: 'String Class',
        insertSnippet: 'TrimStart',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/trimstart.htm'
    },

    // ═══════════════════════════════════════════════════════════════════════
    // Brooks GPL Dictionary — 확장 커버리지 (2026-07-10, 문서/공식 검색 인덱스 대조)
    //   Controller/Thread/Latch/Exception/File/Stream/Array/Console/Vision/
    //   XmlDoc/XmlNode/Modbus/Socket/Tcp·Udp/IPEndPoint 클래스 멤버.
    //   각 sourceUrl은 해당 GPL Dictionary 페이지를 가리킨다.
    // ═══════════════════════════════════════════════════════════════════════
    // ── Controller Class ──
    {
        name: 'Controller.ErrorLog',
        kind: 'property',
        signature: 'Controller.ErrorLog(entry)',
        summary: '시스템 오류 로그의 항목을 String 값으로 반환하거나 오류 로그를 지웁니다.',
        category: 'Controller Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/errorlog.htm'
    },
    {
        name: 'Controller.Load',
        kind: 'method',
        signature: 'Controller.Load(project_folder_path)',
        summary: 'GPL 프로젝트와 관련된 파일을 메모리에 로드하고 컴파일하여 프로시저를 실행할 수 있도록 준비합니다.',
        category: 'Controller Class',
        insertSnippet: 'Controller.Load(${1:project_folder_path})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/load.htm'
    },
    {
        name: 'Controller.PDb',
        kind: 'property',
        signature: 'Controller.PDb(dataid, unit, unit2, array_index, key)',
        summary: '구성 파라미터 데이터베이스에서 접근 가능한 모든 값을 설정하거나 가져옵니다.',
        category: 'Controller Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/pdb.htm'
    },
    {
        name: 'Controller.PDbNum',
        kind: 'property',
        signature: 'Controller.PDbNum(dataid, unit, unit2, array_index, key)',
        summary: '구성 파라미터 데이터베이스의 숫자 값을 최적화된 방식으로 설정하거나 가져옵니다.',
        category: 'Controller Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/pdbnum.htm'
    },
    {
        name: 'Controller.PowerEnabled',
        kind: 'property',
        signature: 'Controller.PowerEnabled',
        summary: '앰프의 고전력(모터 전원)을 켜거나 끄도록 요청하고 고전력의 On/Off 상태를 반환합니다.',
        category: 'Controller Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/powerenabled.htm'
    },
    {
        name: 'Controller.PowerState',
        kind: 'property',
        signature: 'Controller.PowerState(mode)',
        summary: '앰프 고전력 시퀀싱의 현재 상태를 나타내는 Integer 값을 반환합니다.',
        category: 'Controller Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/powerstate.htm'
    },
    {
        name: 'Controller.RecordButton',
        kind: 'property',
        signature: 'Controller.RecordButton',
        summary: '하드웨어 MCP RECORD 버튼이 눌렸는지를 나타내는 래치된 Boolean 값을 읽고 씁니다.',
        category: 'Controller Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/recordbutton.htm'
    },
    {
        name: 'Controller.ShowDialog',
        kind: 'method',
        signature: 'Controller.ShowDialog(button_labels, message, button_index)',
        usage: [
            'Controller.ShowDialog(button_labels, message, button_index)',
            'Controller.ShowDialog(button_labels, message, button_index, text_field)',
            'Controller.ShowDialog(mode, button_labels, message, button_index, field_labels, field_values)'
        ].join('\n'),
        summary: '웹 인터페이스 Operator Control Panel에 팝업 대화 상자를 표시합니다.',
        details: [
            '오버로드된 메서드로 세 가지 형태가 있습니다 — 앞의 두 개는 기본(Basic) 모드, 첫 인자가 `mode`인',
            '여섯 인자 형태는 고급(Advanced) 모드입니다. 고급 모드의 `mode` 값에 따라 화면이 달라집니다.',
            '',
            '| mode | 화면 | field_labels | field_values |',
            '| --- | --- | --- | --- |',
            '| 1 | 사용자가 입력하는 데이터 필드를 세로로 나열(버튼은 아래쪽에 최대 4개) | 각 필드 앞 라벨(최대 12개, 원소 수가 필드 수를 결정) | 초기값이 기본값으로 표시되고, 입력한 값을 돌려받음 |',
            '| 2 | 라벨이 붙은 버튼을 세로로 최대 12개 나열 | 각 버튼의 라벨(원소 수가 버튼 수를 결정) | 사용하지 않음(빈 배열 가능) |',
            '',
            'mode = 2에서는 `button_labels`가 무시되므로 `""`로 둡니다. `button_index`는 눌린 버튼의 번호를',
            '받는 ByRef Integer 변수입니다(첫 버튼이 1).',
            '',
            '다른 스레드가 이미 대화 상자를 띄우고 있으면 대기하며, 사용자가 버튼을 누를 때까지 블로킹됩니다.',
            '대화 상자를 띄운 스레드가 일시 중지·정지되면 즉시 화면에서 내려갑니다.',
            '',
            '브라우저 안에 그려지므로 서식은 HTML로 씁니다 — 줄바꿈은 `<BR>`, 좌측 정렬은 `<p align=left>`…`</p>`.',
            '서식을 포함한 전체 문자열은 약 998바이트까지이며, 문자열에 세로줄(`|`)을 넣을 수 없습니다.'
        ].join('\n'),
        category: 'Controller Class',
        insertSnippet: 'Controller.ShowDialog(${1:button_labels}, ${2:message}, ${3:button_index})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/showdialog.htm'
    },
    {
        name: 'Controller.ShowDialogMCP',
        kind: 'method',
        signature: 'Controller.ShowDialogMCP(button_mask, message, button_return)',
        summary: 'Precise 하드웨어 Manual Control Pendant의 LCD 화면에 팝업 대화 상자를 표시합니다.',
        category: 'Controller Class',
        insertSnippet: 'Controller.ShowDialogMCP(${1:button_mask}, ${2:message}, ${3:button_return})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/showdialogmcp.htm'
    },
    {
        name: 'Controller.SleepTick',
        kind: 'method',
        signature: 'Controller.SleepTick(ticks)',
        summary: '스레드의 실행을 지정한 수의 Trajectory Generator 주기만큼 지연시킵니다.',
        category: 'Controller Class',
        insertSnippet: 'Controller.SleepTick(${1:ticks})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/sleeptick.htm'
    },
    {
        name: 'Controller.SoftEStop',
        kind: 'property',
        signature: 'Controller.SoftEStop',
        summary: 'True일 때 Soft E-Stop 조건을 발생시키는 Boolean 값을 읽고 씁니다.',
        category: 'Controller Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/softestop.htm'
    },
    {
        name: 'Controller.SystemMessage',
        kind: 'method',
        signature: 'Controller.SystemMessage(message)',
        summary: '웹 Operator Control Panel에 표시되는 GPL 시스템 메시지 로그에 메시지를 기록합니다.',
        category: 'Controller Class',
        insertSnippet: 'Controller.SystemMessage(${1:message})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/systemmessage.htm'
    },
    {
        name: 'Controller.SystemSpeed',
        kind: 'property',
        signature: 'Controller.SystemSpeed',
        summary: '모든 로봇 동작의 속도를 줄일 수 있는 속성을 설정하거나 가져옵니다.',
        category: 'Controller Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/systemspeed.htm'
    },
    {
        name: 'Controller.Tick',
        kind: 'property',
        signature: 'Controller.Tick',
        summary: 'Trajectory Generator의 실행 주기를 초 단위로 나타내는 Double 값을 반환합니다.',
        category: 'Controller Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/tick.htm'
    },
    {
        name: 'Controller.Unload',
        kind: 'method',
        signature: 'Controller.Unload(project_name)',
        summary: 'GPL 프로젝트와 관련된 파일 및 데이터를 메모리에서 언로드합니다.',
        category: 'Controller Class',
        insertSnippet: 'Controller.Unload(${1:project_name})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/unload.htm'
    },
    // ── Exception Class ──
    {
        name: 'Exception.Axis',
        kind: 'property',
        signature: 'Exception.Axis',
        summary: '로봇 Exception과 관련된 로봇 축을 나타내는 비트 마스크를 설정하거나 가져옵니다.',
        category: 'Exception Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Exception_Handling/exc_axis.htm'
    },
    {
        name: 'Exception.Clone',
        kind: 'method',
        signature: 'Exception.Clone()',
        summary: 'Exception 객체의 복사본을 반환합니다.',
        category: 'Exception Class',
        returnType: 'Exception',
        insertSnippet: 'Exception.Clone()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Exception_Handling/exc_clone.htm'
    },
    {
        name: 'Exception.ErrorCode',
        kind: 'property',
        signature: 'Exception.ErrorCode',
        summary: '오류 메시지의 번호를 설정하거나 가져옵니다.',
        category: 'Exception Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Exception_Handling/exc_code.htm'
    },
    {
        name: 'Exception.Message',
        kind: 'method',
        signature: 'Exception.Message()',
        summary: 'Exception 객체의 속성을 기반으로 생성된 전체 텍스트 문자열을 반환합니다.',
        category: 'Exception Class',
        insertSnippet: 'Exception.Message()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Exception_Handling/exc_message.htm'
    },
    {
        name: 'Exception.Qualifier',
        kind: 'property',
        signature: 'Exception.Qualifier',
        summary: '일반 Exception의 오류 메시지 한정자를 설정하거나 가져옵니다.',
        category: 'Exception Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Exception_Handling/exc_qualifier.htm'
    },
    {
        name: 'Exception.RobotError',
        kind: 'property',
        signature: 'Exception.RobotError',
        summary: 'Exception이 로봇 유형인지 일반 유형인지를 나타내는 Boolean 값을 설정하거나 가져옵니다.',
        category: 'Exception Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Exception_Handling/exc_roboterror.htm'
    },
    {
        name: 'Exception.RobotNum',
        kind: 'property',
        signature: 'Exception.RobotNum',
        summary: '로봇 Exception과 관련된 로봇 번호를 설정하거나 가져옵니다.',
        category: 'Exception Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Exception_Handling/exc_robot.htm'
    },
    {
        name: 'Exception.UpdateErrorCode',
        kind: 'method',
        signature: 'Exception.UpdateErrorCode()',
        summary: '일반적인(모호한) Exception 오류 코드를 더 구체적인 오류 코드로 갱신합니다.',
        category: 'Exception Class',
        insertSnippet: 'Exception.UpdateErrorCode()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Exception_Handling/updateerrorcode.htm'
    },
    // ── Thread Class ──
    // 출처: GPL_Dictionary/Thread/ 디렉터리의 18개 페이지를 전수 확인(2026-08-28).
    // 클래스 개요와 `New Thread(...)` 생성자는 아래 GPL_CLASS_DOCS의 'Thread' 항목에 있다
    // (생성자는 `Thread.New` 형태로 호출할 수 없으므로 멤버 목록에 넣지 않는다).
    {
        name: 'Thread.Abort',
        kind: 'method',
        signature: 'Thread.Abort()',
        usage: 'thread_object.Abort()',
        summary: '스레드의 실행을 즉시 중지하고 재개할 수 없도록 하며, 다시 실행하려면 Start로 처음부터 시작해야 합니다.',
        details: [
            '인스턴스 메서드입니다. 콘솔 `Stop` 명령과 비슷하게 스레드를 종료하고 내부 자원을 해제합니다.',
            '',
            '- 중단된 스레드는 재개할 수 없고 `Thread.Start`로만 다시 시작할 수 있습니다.',
            '- 나중에 재개할 여지를 남기려면 Abort 대신 `Thread.Suspend`를 사용합니다.',
            '- 스레드가 자기 자신에게 호출하면 정상적인 자원 해제 없이 오류로 종료됩니다.'
        ].join('\n'),
        category: 'Thread Class',
        insertSnippet: 'Thread.Abort()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/abort.htm'
    },
    {
        name: 'Thread.Argument',
        kind: 'property',
        signature: 'Thread.Argument',
        usage: 'thread_object.Argument = <numeric_value>   /   ... = thread_object.Argument',
        summary: '스레드의 매개변수로 사용할 수 있는 숫자 값을 설정하거나 가져옵니다.',
        details: [
            '숫자형 · 읽기/쓰기.',
            '',
            '실행 전에 스레드에 숫자 값을 연결해 두면 스레드가 그 값을 매개변수처럼 읽어 쓸 수 있습니다',
            '(예: 그 스레드가 사용할 데이터를 배열에서 꺼내는 인덱스).'
        ].join('\n'),
        returnType: 'Integer',
        category: 'Thread Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/argument.htm'
    },
    {
        name: 'Thread.CurrentThread',
        kind: 'method',
        signature: 'Thread.CurrentThread()',
        usage: 'thread_object = Thread.CurrentThread()',
        summary: '현재 실행 중인 스레드에 해당하는 Thread 객체를 반환합니다.',
        details: 'Shared 메서드입니다. Thread 객체를 미리 확보해 두지 않아도 현재 실행 중인 스레드를 일시 중단하거나 중단할 수 있습니다.',
        category: 'Thread Class',
        returnType: 'Thread',
        // 조회만 하는 Shared 메서드 — 디버그 hover가 `Thread.CurrentThread.Name`을 제어기에서
        // 평가해도 안전하다(실기기 확인 2026-08-31: 괄호 유무 모두 `String "GPL_Code"` 반환).
        sideEffectFree: true,
        insertSnippet: 'Thread.CurrentThread()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/currentthread.htm'
    },
    {
        name: 'Thread.Join',
        kind: 'method',
        signature: 'Thread.Join(millisecond_timeout)',
        usage: 'status = thread_object.Join(millisecond_timeout)',
        summary: '스레드가 유휴 상태가 될 때까지 제한 시간을 두고 대기합니다.',
        details: [
            '| 반환값 | 의미 |',
            '| --- | --- |',
            '| -1 (True) | 스레드가 유휴 상태이거나 존재하지 않음 |',
            '| 0 (False) | 제한 시간이 지났음(아직 유휴 상태가 아님) |',
            '',
            '`millisecond_timeout`이 0이면 대기 없이 상태만 확인하고, 음수(-1)면 무한정 대기합니다.',
            '대상 스레드가 일시 중단되거나 오류로 멈춰도 계속 기다리며, 유휴 상태가 되거나 삭제될 때 반환합니다.'
        ].join('\n'),
        category: 'Thread Class',
        insertSnippet: 'Thread.Join(${1:millisecond_timeout})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/join.htm'
    },
    {
        name: 'Thread.Name',
        kind: 'property',
        signature: 'Thread.Name',
        usage: 'name_string = thread_object.Name',
        summary: 'Thread 객체와 관련된 스레드의 이름을 String 값으로 반환합니다.',
        details: 'String · 읽기 전용. Thread 객체를 생성할 때 생성자에서 지정한 스레드 이름입니다.',
        returnType: 'String',
        category: 'Thread Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/name.htm'
    },
    {
        name: 'Thread.Project',
        kind: 'property',
        signature: 'Thread.Project',
        usage: 'name_string = thread_object.Project',
        summary: 'Thread 객체와 관련된 프로젝트의 이름을 String 값으로 반환합니다.',
        details: 'String · 읽기 전용. Thread 객체를 생성할 때 생성자에서 지정한 프로젝트 이름입니다.',
        returnType: 'String',
        category: 'Thread Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/project.htm'
    },
    {
        name: 'Thread.Resume',
        kind: 'method',
        signature: 'Thread.Resume()',
        usage: 'thread_object.Resume()',
        summary: '이전에 일시 중단된 스레드의 실행을 재개합니다.',
        details: [
            '인스턴스 메서드입니다. `Thread.Suspend`, 브레이크포인트, 콘솔 `Break` 명령으로 멈춘 스레드를 다시 실행합니다.',
            '',
            '일시 중단 상태가 아니면 아무 일도 하지 않습니다.'
        ].join('\n'),
        category: 'Thread Class',
        insertSnippet: 'Thread.Resume()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/resume.htm'
    },
    {
        name: 'Thread.Schedule',
        kind: 'method',
        signature: 'Thread.Schedule(priority, period, high_priority_time, phase)',
        usage: 'Thread.Schedule(priority, period, high_priority_time, phase)',
        summary: '현재 스레드의 실행 우선순위와 스레드 스케줄링 알고리즘을 변경합니다.',
        details: [
            'Shared 메서드입니다. 특정 Thread 객체가 아니라 **현재 스레드**에 적용되며, POSIX sporadic 스케줄링으로',
            '주기적 실행의 규칙성을 높입니다. period 간격마다(phase만큼 어긋나서) 우선순위가 high_priority_time 동안',
            '올라갔다가 원래 우선순위로 돌아옵니다.',
            '',
            '| 매개변수 | 형 | 값 |',
            '| --- | --- | --- |',
            '| priority | Integer | 0~16. 0이면 일반 사용자 스레드 우선순위(기본 스케줄링), 0 초과면 높은 우선순위와 대체 스케줄링 |',
            '| period | Double | 반복 주기(ms). 0.125의 2의 거듭제곱 배수이며 0.125보다 커야 함(0.250, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0 …) |',
            '| high_priority_time | Double | 주기마다 높은 우선순위로 실행할 시간(ms). 0 초과 period 미만, 0.125 단위로 양자화 |',
            '| phase | Double | 높은 우선순위 구간이 시작되는 위상 오프셋(ms). 0 이상 period 미만, 0.125 단위로 양자화 |',
            '',
            'priority가 0이면 나머지 세 매개변수는 무시됩니다.'
        ].join('\n'),
        category: 'Thread Class',
        insertSnippet: 'Thread.Schedule(${1:priority}, ${2:period}, ${3:high_priority_time}, ${4:phase})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/schedule.htm'
    },
    {
        name: 'Thread.SendEvent',
        kind: 'method',
        signature: 'Thread.SendEvent(event_mask)',
        usage: 'thread_object.SendEvent(event_mask)',
        summary: '특정 스레드에 중요한 전환이 발생했음을 알리는 이벤트를 보냅니다.',
        details: [
            '이벤트는 GPL 프로젝트의 스레드 사이에서 쓰는 동기화 메시지입니다. 전역 변수 폴링과 달리 대기 중인',
            '스레드가 CPU를 거의 쓰지 않고 반응 지연도 낮습니다.',
            '',
            '`event_mask`의 각 비트가 이벤트 하나에 대응합니다. 비트 0(마스크 `&H0001`)이 이벤트 1이며,',
            '이벤트는 최대 16개이므로 `event_mask`의 최대값은 `&HFFFF`입니다. 여러 이벤트를 한 번에 보낼 수 있습니다.'
        ].join('\n'),
        category: 'Thread Class',
        insertSnippet: 'Thread.SendEvent(${1:event_mask})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/sendevent.htm'
    },
    {
        name: 'Thread.Sleep',
        kind: 'method',
        signature: 'Thread.Sleep(milliseconds)',
        usage: 'Thread.Sleep(milliseconds)',
        summary: '현재 스레드를 지정한 시간(밀리초) 동안 대기시킵니다.',
        details: [
            'Shared 메서드입니다. Thread 객체를 통해 호출하더라도 그 객체가 가리키는 스레드와 무관하게',
            '**현재 스레드**가 대기합니다.',
            '',
            '- 0이면 다른 스레드에 실행 기회를 주되, 실행 대기 중인 스레드가 없으면 즉시 재개합니다.',
            '- 음수면 무한정 대기하며 `Thread.Suspend`를 호출한 것과 같습니다.',
            '- 소수점 값을 쓸 수 있으나 Precise 제어기의 최소 대기 단위인 0.125 ms 배수로 올림됩니다.',
            '- 우선순위가 높은 시스템 스레드의 영향으로 밀리초 수준의 지터가 생기므로 시간이 엄격한 주기에는',
            '  적합하지 않습니다. 정밀한 주기 실행에는 `Thread.Schedule`을 사용합니다.',
            '- 대기 중인 스레드가 일시 중단되었다가 재개되면 대기 시간은 재개 시점부터 다시 시작됩니다.'
        ].join('\n'),
        category: 'Thread Class',
        insertSnippet: 'Thread.Sleep(${1:milliseconds})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/sleep.htm'
    },
    {
        name: 'Thread.Start',
        kind: 'method',
        signature: 'Thread.Start()',
        usage: 'thread_object.Start()',
        summary: '독립적인 스레드의 실행을 시작합니다.',
        details: [
            'Thread 객체에 연결된 프로시저를 새 스레드로 실행합니다.',
            '',
            '- 이미 실행 중이면 아무 일도 하지 않고 반환합니다.',
            '- 일시 중단된 스레드를 다시 시작하면 실행 스택을 지운 뒤 프로시저를 처음부터 실행합니다.',
            '- `Thread.Abort`로 중단된 스레드는 이 메서드로만 다시 시작할 수 있습니다.',
            '- 연결된 프로젝트나 프로시저가 없거나 컴파일 오류가 있으면 오류가 발생합니다.'
        ].join('\n'),
        category: 'Thread Class',
        insertSnippet: 'Thread.Start()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/start.htm'
    },
    {
        name: 'Thread.StartProcedure',
        kind: 'property',
        signature: 'Thread.StartProcedure',
        usage: 'name_string = thread_object.StartProcedure',
        summary: 'Thread 객체와 관련된 시작 프로시저의 이름을 String 값으로 반환합니다.',
        details: 'String · 읽기 전용. Thread 객체를 생성할 때 생성자에서 지정한 시작 프로시저 이름입니다.',
        returnType: 'String',
        category: 'Thread Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/startprocedure.htm'
    },
    {
        name: 'Thread.Suspend',
        kind: 'method',
        signature: 'Thread.Suspend()',
        usage: 'thread_object.Suspend()',
        summary: '독립적인 스레드의 실행을 일시 중단합니다.',
        details: [
            '현재 실행 중인 GPL 명령이 끝나는 시점에 스레드를 멈춥니다. `Thread.Resume` 또는 콘솔 `Continue`',
            '명령으로 재개할 수 있습니다.',
            '',
            '스레드가 실제로 멈출 때까지 기다리지 않으므로, 정지 여부는 `Thread.ThreadState`로 확인합니다.'
        ].join('\n'),
        category: 'Thread Class',
        insertSnippet: 'Thread.Suspend()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/suspend.htm'
    },
    {
        name: 'Thread.TestAndSet',
        kind: 'method',
        signature: 'Thread.TestAndSet(variable, new_value)',
        usage: 'old_value = Thread.TestAndSet(variable, new_value)',
        summary: '숫자 변수의 값을 원자적으로 읽고 새 값을 써서 스레드 동기화에 사용합니다.',
        details: [
            'Shared 메서드입니다. `variable`의 이전 값을 읽고 `new_value`를 쓰는 동작이 **하나의 원자적 연산**으로',
            '수행되므로, 읽는 시점과 쓰는 시점 사이에 다른 스레드가 값을 바꿀 수 없습니다.',
            '',
            '여러 스레드가 공유하는 자료 구조를 한 스레드가 수정하는 동안 다른 스레드가 접근해 값이 깨지는 일을',
            '막는 세마포어·락 같은 동기화 수단을 만들 때 사용합니다.'
        ].join('\n'),
        category: 'Thread Class',
        insertSnippet: 'Thread.TestAndSet(${1:variable}, ${2:new_value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/testandset.htm'
    },
    {
        name: 'Thread.ThreadState',
        kind: 'property',
        signature: 'Thread.ThreadState',
        usage: 'state_var = thread_object.ThreadState',
        summary: 'Thread 객체가 지정한 스레드의 실행 상태를 나타내는 숫자 값을 가져옵니다.',
        details: [
            '숫자형 · 읽기 전용.',
            '',
            '| 값 | 상태 |',
            '| --- | --- |',
            '| -1 | 스레드가 존재하지 않음(시작한 적이 없거나 Abort로 정지·삭제됨) |',
            '| 0 | 정상적으로 실행을 마친 유휴 상태. 재개는 불가하지만 Start로 다시 시작할 수 있음 |',
            '| 1 | 실행을 정지하는 중(과도 상태) |',
            '| 2 | 정상적으로 실행 중 |',
            '| 3 | 오류 없이 일시 중지됨. 재개 가능 |',
            '| 4 | 오류와 함께 일시 중지됨. 재개하면 오류가 발생한 명령을 다시 시도함 |'
        ].join('\n'),
        returnType: 'Double',
        category: 'Thread Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/threadstate.htm'
    },
    {
        name: 'Thread.WaitEvent',
        kind: 'method',
        signature: 'Thread.WaitEvent(event_mask, time_out)',
        usage: 'received_events = Thread.WaitEvent(event_mask, time_out)',
        summary: '현재 스레드가 수신한 이벤트를 대기, 검사 및 삭제하고 수신된 이벤트를 나타내는 마스크를 반환합니다.',
        details: [
            'Shared 메서드입니다. **현재 스레드**가 받은 이벤트를 대상으로 하며, 반환값은 수신한 이벤트의',
            '비트마스크입니다. 비트 0(마스크 `&H0001`)이 이벤트 1이고, 이벤트는 최대 16개이므로 `event_mask`의',
            '최대값은 `&HFFFF`입니다. `time_out`은 밀리초 단위입니다.',
            '',
            '| event_mask | time_out | 동작 |',
            '| --- | --- | --- |',
            '| 0 | 무관 | 대기·삭제 없이 그때까지 받은 모든 이벤트의 마스크를 반환 |',
            '| ≠ 0 | 0 | 대기 없이 일치하는 이벤트를 지우고 마스크를 반환 |',
            '| ≠ 0 | > 0 | 일치하는 이벤트를 기다렸다가 지우고 마스크를 반환. 제한 시간이 지나면 0을 반환 |',
            '| ≠ 0 | < 0 | 일치하는 이벤트를 무한정 기다렸다가 지우고 마스크를 반환 |'
        ].join('\n'),
        category: 'Thread Class',
        insertSnippet: 'Thread.WaitEvent(${1:event_mask}, ${2:time_out})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/waitevent.htm'
    },
    // ── Array Class ──
    {
        name: 'Array.GetUpperBound',
        kind: 'property',
        signature: 'Array.GetUpperBound',
        summary: '배열의 특정 차원에 허용되는 최대 배열 인덱스를 반환합니다.',
        category: 'Array Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Array/getupperbound.htm'
    },
    {
        name: 'Array.Length',
        kind: 'property',
        signature: 'Array.Length',
        summary: '배열 전체의 총 요소 개수를 반환합니다.',
        category: 'Array Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Array/alength.htm'
    },
    {
        name: 'Array.Rank',
        kind: 'property',
        signature: 'Array.Rank',
        summary: '배열의 총 차원 수(rank)를 반환합니다.',
        category: 'Array Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Array/rank.htm'
    },
    // ── Console Class ──
    {
        name: 'Console.Write',
        kind: 'method',
        signature: 'Console.Write(value)',
        summary: '숫자 또는 문자열 값을 줄 종료 문자 없이 GPL 콘솔에 출력하는 진단용 메서드입니다.',
        category: 'Console Class',
        insertSnippet: 'Console.Write(${1:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Console/c_write.htm'
    },
    {
        name: 'Console.WriteLine',
        kind: 'method',
        signature: 'Console.WriteLine(value)',
        summary: '숫자 또는 문자열 값을 줄 종료 문자와 함께 GPL 콘솔에 출력하는 진단용 메서드입니다.',
        category: 'Console Class',
        insertSnippet: 'Console.WriteLine(${1:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Console/c_writeline.htm'
    },
    // ── File Class ──
    {
        name: 'File.ComputeCRC',
        kind: 'function',
        signature: 'File.ComputeCRC(path)',
        summary: '파일을 읽어 파일 내 모든 데이터에 대한 CRC(순환 중복 검사) 값을 계산합니다.',
        category: 'File Class',
        insertSnippet: 'File.ComputeCRC(${1:path})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/File/computeCRC.htm'
    },
    {
        name: 'File.ComputeLength',
        kind: 'function',
        signature: 'File.ComputeLength(path)',
        summary: '파일 내 모든 데이터를 읽어 파일의 길이를 계산합니다.',
        category: 'File Class',
        insertSnippet: 'File.ComputeLength(${1:path})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/File/computelength.htm'
    },
    {
        name: 'File.Copy',
        kind: 'method',
        signature: 'File.Copy(source_file, destination_file, overwrite)',
        summary: '플래시 디스크나 ROMDISK 같은 장치에서 단일 파일을 복사합니다.',
        category: 'File Class',
        insertSnippet: 'File.Copy(${1:source_file}, ${2:destination_file}, ${3:overwrite})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/File/copyfile.htm'
    },
    {
        name: 'File.CreateDirectory',
        kind: 'method',
        signature: 'File.CreateDirectory(path)',
        summary: '파일 디렉터리와 해당 디렉터리까지의 경로를 생성합니다.',
        category: 'File Class',
        insertSnippet: 'File.CreateDirectory(${1:path})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/File/createdir.htm'
    },
    {
        name: 'File.DeleteDirectory',
        kind: 'method',
        signature: 'File.DeleteDirectory(path)',
        summary: '비어 있는 단일 파일 디렉터리를 삭제합니다.',
        category: 'File Class',
        insertSnippet: 'File.DeleteDirectory(${1:path})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/File/deletedir.htm'
    },
    {
        name: 'File.DeleteFile',
        kind: 'method',
        signature: 'File.DeleteFile(path)',
        summary: '단일 파일을 삭제합니다.',
        category: 'File Class',
        insertSnippet: 'File.DeleteFile(${1:path})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/File/deletefile.htm'
    },
    {
        name: 'File.GetDirectories',
        kind: 'method',
        signature: 'File.GetDirectories(path)',
        summary: '디렉터리를 읽어 모든 하위 디렉터리의 이름을 문자열 배열로 반환합니다.',
        category: 'File Class',
        insertSnippet: 'File.GetDirectories(${1:path})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/File/getdir.htm'
    },
    {
        name: 'File.GetFiles',
        kind: 'method',
        signature: 'File.GetFiles(path)',
        summary: '디렉터리를 읽어 디렉터리가 아닌 모든 파일의 이름을 문자열 배열로 반환합니다.',
        category: 'File Class',
        insertSnippet: 'File.GetFiles(${1:path})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/File/getfiles.htm'
    },
    {
        name: 'File.Length',
        kind: 'function',
        signature: 'File.Length(path)',
        summary: '디렉터리에 기록된 파일의 길이를 반환합니다.',
        category: 'File Class',
        insertSnippet: 'File.Length(${1:path})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/File/filelength.htm'
    },
    // ── StreamReader Class ──
    {
        name: 'StreamReader.Close',
        kind: 'method',
        signature: 'StreamReader.Close()',
        summary: 'StreamReader 객체와 연결된 파일 또는 장치를 닫습니다.',
        category: 'StreamReader Class',
        insertSnippet: 'StreamReader.Close()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamReader/close_sr.htm'
    },
    {
        name: 'StreamReader.Peek',
        kind: 'method',
        signature: 'StreamReader.Peek()',
        summary: '입력 스트림에서 다음 바이트를 스트림에서 제거하지 않고 반환합니다.',
        category: 'StreamReader Class',
        insertSnippet: 'StreamReader.Peek()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamReader/peek_sr.htm'
    },
    {
        name: 'StreamReader.Read',
        kind: 'method',
        signature: 'StreamReader.Read()',
        summary: '입력 스트림에서 다음 바이트를 반환하고 해당 바이트를 스트림에서 제거합니다.',
        category: 'StreamReader Class',
        insertSnippet: 'StreamReader.Read()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamReader/read_sr.htm'
    },
    {
        name: 'StreamReader.ReadLine',
        kind: 'method',
        signature: 'StreamReader.ReadLine()',
        summary: '입력 스트림에서 LF, CR 또는 CR-LF로 종료되는 한 줄을 읽습니다.',
        category: 'StreamReader Class',
        insertSnippet: 'StreamReader.ReadLine()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamReader/readline_sr.htm'
    },
    // ── StreamWriter Class ──
    {
        name: 'StreamWriter.AutoFlush',
        kind: 'property',
        signature: 'StreamWriter.AutoFlush',
        summary: '출력을 버퍼링할지 여부를 제어하는 AutoFlush 속성을 설정하거나 가져옵니다.',
        category: 'StreamWriter Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/autoflush_wr.htm'
    },
    {
        name: 'StreamWriter.Close',
        kind: 'method',
        signature: 'StreamWriter.Close()',
        summary: 'StreamWriter 객체와 연결된 파일 또는 장치를 닫습니다.',
        category: 'StreamWriter Class',
        insertSnippet: 'StreamWriter.Close()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/close_wr.htm'
    },
    {
        name: 'StreamWriter.Flush',
        kind: 'method',
        signature: 'StreamWriter.Flush()',
        summary: 'StreamWriter 객체의 버퍼에 저장된 데이터를 즉시 기록합니다.',
        category: 'StreamWriter Class',
        insertSnippet: 'StreamWriter.Flush()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/flush_wr.htm'
    },
    {
        name: 'StreamWriter.NewLine',
        kind: 'property',
        signature: 'StreamWriter.NewLine',
        summary: 'WriteLine 메서드가 줄을 종료하는 방식을 제어하는 NewLine 속성을 설정하거나 가져옵니다.',
        category: 'StreamWriter Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/newline_wr.htm'
    },
    {
        name: 'StreamWriter.Write',
        kind: 'method',
        signature: 'StreamWriter.Write(value)',
        summary: '숫자 또는 문자열을 출력 장치나 파일에 기록합니다.',
        category: 'StreamWriter Class',
        insertSnippet: 'StreamWriter.Write(${1:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/write_wr.htm'
    },
    {
        name: 'StreamWriter.WriteLine',
        kind: 'method',
        signature: 'StreamWriter.WriteLine(value)',
        summary: '숫자 또는 문자열을 출력 장치나 파일에 기록한 뒤 NewLine 줄 종료 문자를 덧붙입니다.',
        category: 'StreamWriter Class',
        insertSnippet: 'StreamWriter.WriteLine(${1:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/writeline_wr.htm'
    },
    // ── Vision Class ──
    {
        name: 'Vision.Disconnect',
        kind: 'method',
        signature: 'Vision.Disconnect()',
        summary: '비전 객체와 연결된 네트워크 연결을 닫습니다.',
        category: 'Vision Class',
        insertSnippet: 'Vision.Disconnect()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vs_disconnect.htm'
    },
    {
        name: 'Vision.ErrorCode',
        kind: 'property',
        signature: 'Vision.ErrorCode',
        summary: '마지막으로 실행된 비전 프로세스에 대한 정수 오류 코드를 가져옵니다.',
        category: 'Vision Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vs_errorcode.htm'
    },
    {
        name: 'Vision.Instance',
        kind: 'property',
        signature: 'Vision.Instance',
        summary: '비전 객체와 연결된 PreciseVision 인스턴스 번호를 설정하거나 가져옵니다.',
        category: 'Vision Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vs_instance.htm'
    },
    {
        name: 'Vision.IPAddress',
        kind: 'property',
        signature: 'Vision.IPAddress',
        summary: '비전 객체와 연결된 PreciseVision 소프트웨어를 실행하는 PC의 IP 주소를 문자열 값으로 설정하거나 가져옵니다.',
        category: 'Vision Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vs_ipaddress.htm'
    },
    {
        name: 'Vision.Process',
        kind: 'method',
        signature: 'Vision.Process(vision_process_name, vision_process_id)',
        summary: 'PreciseVision에 비전 프로세스를 실행하도록 요청하고 프로세스가 완료될 때까지 대기합니다.',
        category: 'Vision Class',
        insertSnippet: 'Vision.Process(${1:vision_process_name}, ${2:vision_process_id})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vs_process.htm'
    },
    {
        name: 'Vision.Result',
        kind: 'method',
        signature: 'Vision.Result(vision_tool_name, index, location_object)',
        summary: '비전 도구에서 나온 단일 결과 집합을 담은 VisResult 객체를 반환합니다.',
        category: 'Vision Class',
        returnType: 'VisResult',
        insertSnippet: 'Vision.Result(${1:vision_tool_name}, ${2:index}, ${3:location_object})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vs_result.htm'
    },
    {
        name: 'Vision.ResultCount',
        kind: 'method',
        signature: 'Vision.ResultCount(vision_tool_name)',
        summary: '마지막으로 실행된 비전 프로세스에서 비전 도구가 생성한 결과의 개수를 가져옵니다.',
        category: 'Vision Class',
        insertSnippet: 'Vision.ResultCount(${1:vision_tool_name})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vs_resultcount.htm'
    },
    {
        name: 'Vision.Status',
        kind: 'property',
        signature: 'Vision.Status',
        summary: '비전 프로세스에 대한 숫자 상태 코드를 가져옵니다.',
        category: 'Vision Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vs_status.htm'
    },
    {
        name: 'Vision.ToolProperty',
        kind: 'property',
        signature: 'Vision.ToolProperty',
        summary: 'PreciseVision 도구의 속성 값 또는 비전 서버의 일반 시스템 속성을 설정하거나 가져옵니다.',
        category: 'Vision Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vs_toolproperty.htm'
    },
    // ── VisResult Class ──
    {
        name: 'VisResult.ErrorCode',
        kind: 'property',
        signature: 'VisResult.ErrorCode',
        summary: '비전 결과 객체에 대한 정수 오류 코드를 가져옵니다.',
        category: 'VisResult Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vsr_errorcode.htm'
    },
    {
        name: 'VisResult.Info',
        kind: 'property',
        signature: 'VisResult.Info',
        summary: '비전 결과 객체의 숫자 정보 배열에서 Double 값을 반환합니다.',
        category: 'VisResult Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vsr_info.htm'
    },
    {
        name: 'VisResult.InfoCount',
        kind: 'property',
        signature: 'VisResult.InfoCount',
        summary: '비전 결과 객체의 숫자 정보 배열에 있는 요소의 개수를 Integer 값으로 반환합니다.',
        category: 'VisResult Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vsr_infocount.htm'
    },
    {
        name: 'VisResult.InfoString',
        kind: 'property',
        signature: 'VisResult.InfoString',
        summary: '비전 결과 객체에 텍스트 결과가 포함되어 있으면 문자열 값을 반환합니다.',
        category: 'VisResult Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vsr_infostring.htm'
    },
    {
        name: 'VisResult.InspectActual',
        kind: 'property',
        signature: 'VisResult.InspectActual',
        summary: '비전 검사 프로세스에서 테스트된 도구 속성의 값을 나타내는 Double을 반환합니다.',
        category: 'VisResult Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vsr_ins_actual.htm'
    },
    {
        name: 'VisResult.InspectPassed',
        kind: 'property',
        signature: 'VisResult.InspectPassed',
        summary: '비전 결과의 속성이 도구의 비전 검사 기준을 충족했는지 여부를 나타내는 Boolean을 반환합니다.',
        category: 'VisResult Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vsr_ins_status.htm'
    },
    {
        name: 'VisResult.Loc',
        kind: 'property',
        signature: 'VisResult.Loc',
        summary: '비전 결과 객체의 위치 및 방향 정보를 담은 Location 객체를 반환합니다.',
        category: 'VisResult Class',
        returnType: 'Location',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vsr_loc.htm'
    },
    {
        name: 'VisResult.ProcessID',
        kind: 'property',
        signature: 'VisResult.ProcessID',
        summary: '비전 결과를 생성한 비전 프로세스의 ID를 Integer 값으로 반환합니다.',
        category: 'VisResult Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vsr_processid.htm'
    },
    {
        name: 'VisResult.Type',
        kind: 'property',
        signature: 'VisResult.Type',
        summary: '비전 결과 객체의 Integer 형식 코드를 반환합니다.',
        category: 'VisResult Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/vsr_type.htm'
    },
    // ── XmlDoc Class ──
    {
        name: 'XmlDoc.CreateNode',
        kind: 'method',
        signature: 'XmlDoc.CreateNode(type, name)',
        summary: 'DOM 트리에 추가할 수 있는 새 노드 객체를 생성하여 반환합니다.',
        category: 'XmlDoc Class',
        returnType: 'XmlNode',
        insertSnippet: 'XmlDoc.CreateNode(${1:type}, ${2:name})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlDoc/createnode_xmldoc.htm'
    },
    {
        name: 'XmlDoc.DocumentElement',
        kind: 'method',
        signature: 'XmlDoc.DocumentElement()',
        summary: 'DOM 문서 트리의 최상위 요소를 XmlNode 객체로 반환합니다.',
        category: 'XmlDoc Class',
        returnType: 'XmlNode',
        insertSnippet: 'XmlDoc.DocumentElement()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlDoc/doc_element_xmldoc.htm'
    },
    {
        name: 'XmlDoc.ErrorCode',
        kind: 'property',
        signature: 'XmlDoc.ErrorCode',
        summary: 'DOM 문서 트리에 대한 가장 최근의 주요 작업의 오류 코드를 반환합니다.',
        category: 'XmlDoc Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlDoc/errorcode_xmldoc.htm'
    },
    {
        name: 'XmlDoc.LoadFile',
        kind: 'method',
        signature: 'XmlDoc.LoadFile(input_file, options)',
        summary: '파일에서 XML 텍스트 문서를 로드 및 파싱하여 생성된 XmlDoc DOM 트리 객체를 반환합니다.',
        category: 'XmlDoc Class',
        returnType: 'XmlDoc',
        insertSnippet: 'XmlDoc.LoadFile(${1:input_file}, ${2:options})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlDoc/loadfile_xmldoc.htm'
    },
    {
        name: 'XmlDoc.LoadString',
        kind: 'method',
        signature: 'XmlDoc.LoadString(input_string, options)',
        summary: '문자열에서 XML 텍스트 문서를 파싱하여 생성된 XmlDoc DOM 트리 객체를 반환합니다.',
        category: 'XmlDoc Class',
        returnType: 'XmlDoc',
        insertSnippet: 'XmlDoc.LoadString(${1:input_string}, ${2:options})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlDoc/loadstring_xmldoc.htm'
    },
    {
        name: 'XmlDoc.Message',
        kind: 'property',
        signature: 'XmlDoc.Message',
        summary: 'DOM 문서 트리에 대한 가장 최근의 주요 작업의 상세 오류 메시지를 반환합니다.',
        category: 'XmlDoc Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlDoc/message_xmldoc.htm'
    },
    {
        name: 'XmlDoc.SaveFile',
        kind: 'method',
        signature: 'XmlDoc.SaveFile(output_file, options)',
        summary: 'DOM 트리 문서를 XML 텍스트 형식으로 변환하여 데이터를 파일에 씁니다.',
        category: 'XmlDoc Class',
        insertSnippet: 'XmlDoc.SaveFile(${1:output_file}, ${2:options})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlDoc/savefile_xmldoc.htm'
    },
    {
        name: 'XmlDoc.SaveString',
        kind: 'method',
        signature: 'XmlDoc.SaveString(output_string, options)',
        summary: 'DOM 트리 문서를 XML 텍스트 형식으로 변환하여 데이터를 문자열에 씁니다.',
        category: 'XmlDoc Class',
        insertSnippet: 'XmlDoc.SaveString(${1:output_string}, ${2:options})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlDoc/savestring_xmldoc.htm'
    },
    // ── Modbus Class ──
    {
        name: 'Modbus.Close',
        kind: 'method',
        signature: 'Modbus.Close()',
        summary: 'Modbus 객체에 연결된 네트워크 연결을 닫습니다.',
        category: 'Modbus Class',
        insertSnippet: 'Modbus.Close()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Modbus/mb_close.htm'
    },
    {
        name: 'Modbus.ReadCoils',
        kind: 'method',
        signature: 'Modbus.ReadCoils(start, number, value_array)',
        summary: 'MODBUS 슬레이브에서 하나 이상의 출력을 읽어 그 값을 Boolean 배열로 반환합니다.',
        category: 'Modbus Class',
        insertSnippet: 'Modbus.ReadCoils(${1:start}, ${2:number}, ${3:value_array})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Modbus/mb_readcoils.htm'
    },
    {
        name: 'Modbus.ReadDeviceID',
        kind: 'method',
        signature: 'Modbus.ReadDeviceID(object_id)',
        summary: 'MODBUS 슬레이브에서 장치 식별 정보를 읽어 String 값으로 반환합니다.',
        category: 'Modbus Class',
        insertSnippet: 'Modbus.ReadDeviceID(${1:object_id})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Modbus/mb_readdeviceid.htm'
    },
    {
        name: 'Modbus.ReadDiscreteInputs',
        kind: 'method',
        signature: 'Modbus.ReadDiscreteInputs(start, number, value_array)',
        summary: 'MODBUS 슬레이브에서 하나 이상의 입력을 읽어 그 값을 Boolean 배열로 반환합니다.',
        category: 'Modbus Class',
        insertSnippet: 'Modbus.ReadDiscreteInputs(${1:start}, ${2:number}, ${3:value_array})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Modbus/mb_readdisin.htm'
    },
    // ── XmlNode Class ──
    {
        name: 'XmlNode.AddAttribute',
        kind: 'method',
        signature: 'XmlNode.AddAttribute(attribute, value)',
        summary: '새 XML 속성을 만들어 현재 노드의 자식으로 추가합니다.',
        category: 'XmlNode Class',
        insertSnippet: 'XmlNode.AddAttribute(${1:attribute}, ${2:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/addattribute_xmlnode.htm'
    },
    {
        name: 'XmlNode.AddElement',
        kind: 'method',
        signature: 'XmlNode.AddElement(element, value)',
        summary: '새 XML 요소를 만들어 현재 노드의 자식으로 추가합니다.',
        category: 'XmlNode Class',
        insertSnippet: 'XmlNode.AddElement(${1:element}, ${2:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/addelement_xmlnode.htm'
    },
    {
        name: 'XmlNode.AddElementNode',
        kind: 'method',
        signature: 'XmlNode.AddElementNode(element, value)',
        summary: '새 XML 요소를 자식으로 추가하고, 생성된 요소 노드의 XmlNode 객체를 반환합니다.',
        category: 'XmlNode Class',
        returnType: 'XmlNode',
        insertSnippet: 'XmlNode.AddElementNode(${1:element}, ${2:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/addelementnode_xmlnode.htm'
    },
    {
        name: 'XmlNode.AppendChild',
        kind: 'method',
        signature: 'XmlNode.AppendChild(new_node)',
        summary: '새 노드를 현재 노드의 마지막 자식으로 추가합니다(텍스트 노드는 적절히 병합).',
        category: 'XmlNode Class',
        insertSnippet: 'XmlNode.AppendChild(${1:new_node})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/appendchild_xmlnode.htm'
    },
    {
        name: 'XmlNode.ChildNodeCount',
        kind: 'property',
        signature: 'XmlNode.ChildNodeCount',
        summary: '현재 노드의 자식 노드 수를 반환합니다(속성은 포함하지 않음).',
        category: 'XmlNode Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/childnodecount_xmlnode.htm'
    },
    {
        name: 'XmlNode.Clone',
        kind: 'method',
        signature: 'XmlNode.Clone(deep, xmldoc)',
        summary: '현재 노드의 복제본인 새 XML 노드를 생성합니다.',
        category: 'XmlNode Class',
        returnType: 'XmlNode',
        insertSnippet: 'XmlNode.Clone(${1:deep}, ${2:xmldoc})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/clone_xmlnode.htm'
    },
    {
        name: 'XmlNode.FirstChild',
        kind: 'method',
        signature: 'XmlNode.FirstChild()',
        summary: '현재 노드의 첫 번째 자식 노드를 반환합니다.',
        category: 'XmlNode Class',
        returnType: 'XmlNode',
        insertSnippet: 'XmlNode.FirstChild()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/firstchild_xmlnode.htm'
    },
    {
        name: 'XmlNode.GetAttribute',
        kind: 'method',
        signature: 'XmlNode.GetAttribute(attribute)',
        summary: '현재 노드의 기존 속성 값을 String으로 반환합니다.',
        category: 'XmlNode Class',
        insertSnippet: 'XmlNode.GetAttribute(${1:attribute})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/getattribute_xmlnode.htm'
    },
    {
        name: 'XmlNode.GetAttributeNode',
        kind: 'method',
        signature: 'XmlNode.GetAttributeNode(attribute)',
        summary: '지정한 이름의 속성 노드(현재 노드의 자식)를 반환합니다.',
        category: 'XmlNode Class',
        returnType: 'XmlNode',
        insertSnippet: 'XmlNode.GetAttributeNode(${1:attribute})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/getattributenode_xmlnode.htm'
    },
    {
        name: 'XmlNode.GetElement',
        kind: 'method',
        signature: 'XmlNode.GetElement(element)',
        summary: '현재 노드의 자식 요소 값을 String으로 반환합니다.',
        category: 'XmlNode Class',
        insertSnippet: 'XmlNode.GetElement(${1:element})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/getelement_xmlnode.htm'
    },
    {
        name: 'XmlNode.GetElementNode',
        kind: 'method',
        signature: 'XmlNode.GetElementNode(element)',
        summary: '지정한 이름의 요소 노드(현재 노드의 자식)를 반환합니다.',
        category: 'XmlNode Class',
        returnType: 'XmlNode',
        insertSnippet: 'XmlNode.GetElementNode(${1:element})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/getelementnode_xmlnode.htm'
    },
    {
        name: 'XmlNode.HasAttribute',
        kind: 'method',
        signature: 'XmlNode.HasAttribute(attribute)',
        summary: '지정한 이름의 속성 노드가 현재 노드의 자식이면 True를 반환합니다.',
        category: 'XmlNode Class',
        insertSnippet: 'XmlNode.HasAttribute(${1:attribute})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/hasattribute_xmlnode.htm'
    },
    {
        name: 'XmlNode.HasChildNodes',
        kind: 'property',
        signature: 'XmlNode.HasChildNodes',
        summary: '현재 노드에 속성이 아닌 자식 노드가 있으면 True를 반환합니다.',
        category: 'XmlNode Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/haschildnodes_xmlnode.htm'
    },
    {
        name: 'XmlNode.HasElement',
        kind: 'method',
        signature: 'XmlNode.HasElement(element)',
        summary: '지정한 요소가 현재 노드의 자식이면 True를 반환합니다.',
        category: 'XmlNode Class',
        insertSnippet: 'XmlNode.HasElement(${1:element})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/haselement_xmlnode.htm'
    },
    {
        name: 'XmlNode.InsertAfter',
        kind: 'method',
        signature: 'XmlNode.InsertAfter(new_child, ref_child)',
        summary: '지정한 노드 뒤에 새 노드를 현재 노드의 자식 목록에 삽입합니다.',
        category: 'XmlNode Class',
        insertSnippet: 'XmlNode.InsertAfter(${1:new_child}, ${2:ref_child})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/insertafter_xmlnode.htm'
    },
    {
        name: 'XmlNode.InsertBefore',
        kind: 'method',
        signature: 'XmlNode.InsertBefore(new_child, ref_child)',
        summary: '지정한 노드 앞에 새 노드를 현재 노드의 자식 목록에 삽입합니다.',
        category: 'XmlNode Class',
        insertSnippet: 'XmlNode.InsertBefore(${1:new_child}, ${2:ref_child})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/insertbefore_xmlnode.htm'
    },
    {
        name: 'XmlNode.LastChild',
        kind: 'method',
        signature: 'XmlNode.LastChild()',
        summary: '현재 노드의 마지막 자식 노드를 반환합니다.',
        category: 'XmlNode Class',
        returnType: 'XmlNode',
        insertSnippet: 'XmlNode.LastChild()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/lastchild_xmlnode.htm'
    },
    {
        name: 'XmlNode.Name',
        kind: 'property',
        signature: 'XmlNode.Name',
        summary: '현재 노드에 이름이 있으면 그 이름을 반환합니다.',
        category: 'XmlNode Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/name_xmlnode.htm'
    },
    {
        name: 'XmlNode.NextSibling',
        kind: 'method',
        signature: 'XmlNode.NextSibling()',
        summary: '현재 노드의 다음 형제 노드를 반환합니다.',
        category: 'XmlNode Class',
        returnType: 'XmlNode',
        insertSnippet: 'XmlNode.NextSibling()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/nextsibling_xmlnode.htm'
    },
    {
        name: 'XmlNode.OwnerDocument',
        kind: 'method',
        signature: 'XmlNode.OwnerDocument()',
        summary: '현재 노드가 속한 DOM 트리의 XmlDoc 객체를 반환합니다.',
        category: 'XmlNode Class',
        returnType: 'XmlDoc',
        insertSnippet: 'XmlNode.OwnerDocument()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/ownerdoc_xmlnode.htm'
    },
    {
        name: 'XmlNode.ParentNode',
        kind: 'method',
        signature: 'XmlNode.ParentNode()',
        summary: '현재 노드의 부모 노드를 반환합니다.',
        category: 'XmlNode Class',
        returnType: 'XmlNode',
        insertSnippet: 'XmlNode.ParentNode()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/parentnode_xmlnode.htm'
    },
    {
        name: 'XmlNode.PreviousSibling',
        kind: 'method',
        signature: 'XmlNode.PreviousSibling()',
        summary: '현재 노드의 이전 형제 노드를 반환합니다.',
        category: 'XmlNode Class',
        returnType: 'XmlNode',
        insertSnippet: 'XmlNode.PreviousSibling()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/previoussibling_xmlnode.htm'
    },
    {
        name: 'XmlNode.RemoveAttribute',
        kind: 'method',
        signature: 'XmlNode.RemoveAttribute(attribute)',
        summary: '지정한 자식 속성 노드와 그 하위 트리를 DOM 트리에서 제거합니다.',
        category: 'XmlNode Class',
        insertSnippet: 'XmlNode.RemoveAttribute(${1:attribute})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/removeattribute_xmlnode.htm'
    },
    {
        name: 'XmlNode.RemoveChild',
        kind: 'method',
        signature: 'XmlNode.RemoveChild(old_child)',
        summary: '지정한 자식 노드와 그 하위 트리를 DOM 트리에서 제거합니다.',
        category: 'XmlNode Class',
        insertSnippet: 'XmlNode.RemoveChild(${1:old_child})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/removechild_xmlnode.htm'
    },
    {
        name: 'XmlNode.RemoveElement',
        kind: 'method',
        signature: 'XmlNode.RemoveElement(element)',
        summary: '지정한 자식 요소 노드와 그 하위 트리를 DOM 트리에서 제거합니다.',
        category: 'XmlNode Class',
        insertSnippet: 'XmlNode.RemoveElement(${1:element})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/removeelement_xmlnode.htm'
    },
    {
        name: 'XmlNode.ReplaceChild',
        kind: 'method',
        signature: 'XmlNode.ReplaceChild(new_child, old_child)',
        summary: '현재 노드의 자식을 새 노드로 교체합니다.',
        category: 'XmlNode Class',
        insertSnippet: 'XmlNode.ReplaceChild(${1:new_child}, ${2:old_child})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/replacechild_xmlnode.htm'
    },
    {
        name: 'XmlNode.SetAttribute',
        kind: 'method',
        signature: 'XmlNode.SetAttribute(attribute, new_value)',
        summary: '기존 속성의 값을 변경합니다.',
        category: 'XmlNode Class',
        insertSnippet: 'XmlNode.SetAttribute(${1:attribute}, ${2:new_value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/setattribute_xmlnode.htm'
    },
    {
        name: 'XmlNode.SetElement',
        kind: 'method',
        signature: 'XmlNode.SetElement(element, new_value)',
        summary: '기존 자식 요소의 값을 변경합니다.',
        category: 'XmlNode Class',
        insertSnippet: 'XmlNode.SetElement(${1:element}, ${2:new_value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/setelement_xmlnode.htm'
    },
    {
        name: 'XmlNode.Type',
        kind: 'property',
        signature: 'XmlNode.Type',
        summary: '현재 노드의 유형을 String으로 반환합니다.',
        category: 'XmlNode Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/type_xmlnode.htm'
    },
    {
        name: 'XmlNode.Value',
        kind: 'property',
        signature: 'XmlNode.Value',
        summary: '현재 노드의 값을 String으로 반환하거나 값을 설정합니다.',
        category: 'XmlNode Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlNode/value_xmlnode.htm'
    },
    // ── Modbus Class ──
    {
        name: 'Modbus.ReadHoldingRegisters',
        kind: 'method',
        signature: 'Modbus.ReadHoldingRegisters(start, number, value_array)',
        summary: 'MODBUS 슬레이브에서 하나 이상의 홀딩 레지스터를 읽어 Integer 배열로 반환합니다.',
        category: 'Modbus Class',
        insertSnippet: 'Modbus.ReadHoldingRegisters(${1:start}, ${2:number}, ${3:value_array})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Modbus/mb_readhldreg.htm'
    },
    {
        name: 'Modbus.ReadInputRegisters',
        kind: 'method',
        signature: 'Modbus.ReadInputRegisters(start, number, value_array)',
        summary: 'MODBUS 슬레이브에서 하나 이상의 입력 레지스터를 읽어 Integer 배열로 반환합니다.',
        category: 'Modbus Class',
        insertSnippet: 'Modbus.ReadInputRegisters(${1:start}, ${2:number}, ${3:value_array})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Modbus/mb_readinpreg.htm'
    },
    {
        name: 'Modbus.Timeout',
        kind: 'property',
        signature: 'Modbus.Timeout',
        summary: 'MODBUS 슬레이브의 응답을 기다리는 타임아웃(밀리초)을 설정하거나 반환합니다.',
        category: 'Modbus Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Modbus/mb_timeout.htm'
    },
    {
        name: 'Modbus.WriteMultipleCoils',
        kind: 'method',
        signature: 'Modbus.WriteMultipleCoils(start, value_array)',
        summary: 'MODBUS 슬레이브에 하나 이상의 출력(코일)을 씁니다.',
        category: 'Modbus Class',
        insertSnippet: 'Modbus.WriteMultipleCoils(${1:start}, ${2:value_array})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Modbus/mb_writemcoils.htm'
    },
    {
        name: 'Modbus.WriteMultipleRegisters',
        kind: 'method',
        signature: 'Modbus.WriteMultipleRegisters(start, value_array)',
        summary: 'MODBUS 슬레이브에 하나 이상의 홀딩 레지스터 값을 씁니다.',
        category: 'Modbus Class',
        insertSnippet: 'Modbus.WriteMultipleRegisters(${1:start}, ${2:value_array})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Modbus/mb_writemregs.htm'
    },
    {
        name: 'Modbus.WriteSingleCoil',
        kind: 'method',
        signature: 'Modbus.WriteSingleCoil(coil, value)',
        summary: 'MODBUS 슬레이브에 단일 출력(코일)을 씁니다.',
        category: 'Modbus Class',
        insertSnippet: 'Modbus.WriteSingleCoil(${1:coil}, ${2:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Modbus/mb_writescoils.htm'
    },
    {
        name: 'Modbus.WriteSingleRegister',
        kind: 'method',
        signature: 'Modbus.WriteSingleRegister(register, value)',
        summary: 'MODBUS 슬레이브에 단일 홀딩 레지스터 값을 씁니다.',
        category: 'Modbus Class',
        insertSnippet: 'Modbus.WriteSingleRegister(${1:register}, ${2:value})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Modbus/mb_writesreg.htm'
    },
    // ── IPEndPoint Class ──
    {
        name: 'IPEndPoint.IPAddress',
        kind: 'property',
        signature: 'IPEndPoint.IPAddress',
        summary: 'IPEndPoint 객체에 연결된 IP 주소를 설정하거나 반환합니다.',
        category: 'IPEndPoint Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/IPEndPoint/ipaddr_ipe.htm'
    },
    {
        name: 'IPEndPoint.Port',
        kind: 'property',
        signature: 'IPEndPoint.Port',
        summary: 'IPEndPoint 객체에 연결된 포트 번호를 설정하거나 반환합니다.',
        category: 'IPEndPoint Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/IPEndPoint/port_ipe.htm'
    },
    // ── Socket Class ──
    {
        name: 'Socket.Available',
        kind: 'property',
        signature: 'Socket.Available',
        summary: '소켓에서 현재 수신 가능한 데이터 바이트 수를 반환합니다.',
        category: 'Socket Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/Socket/available_sock.htm'
    },
    {
        name: 'Socket.Blocking',
        kind: 'property',
        signature: 'Socket.Blocking',
        summary: '소켓의 블로킹 I/O 모드를 설정하거나 반환합니다.',
        category: 'Socket Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/Socket/blocking_sock.htm'
    },
    {
        name: 'Socket.Close',
        kind: 'method',
        signature: 'Socket.Close()',
        summary: '소켓(및 TcpListener/TcpClient/UdpClient)에 연결된 네트워크 연결을 닫습니다.',
        category: 'Socket Class',
        insertSnippet: 'Socket.Close()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/Socket/close_sock.htm'
    },
    {
        name: 'Socket.Connect',
        kind: 'method',
        signature: 'Socket.Connect(remote_endpoint)',
        summary: '원격 TCP 서버와의 TCP 클라이언트 연결을 시작합니다.',
        category: 'Socket Class',
        insertSnippet: 'Socket.Connect(${1:remote_endpoint})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/Socket/connect_sock.htm'
    },
    {
        name: 'Socket.KeepAlive',
        kind: 'property',
        signature: 'Socket.KeepAlive',
        summary: '현재 TCP 연결에서 keep-alive 메시지 자동 전송 여부를 제어하는 플래그를 설정하거나 반환합니다.',
        category: 'Socket Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/Socket/keepalive_sock.htm'
    },
    {
        name: 'Socket.Receive',
        kind: 'method',
        signature: 'Socket.Receive(input_buffer, max_length)',
        summary: '열린 TCP 연결로부터 메시지를 수신합니다.',
        category: 'Socket Class',
        insertSnippet: 'Socket.Receive(${1:input_buffer}, ${2:max_length})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/Socket/receive_sock.htm'
    },
    {
        name: 'Socket.ReceiveFrom',
        kind: 'method',
        signature: 'Socket.ReceiveFrom(input_buffer, max_length, remote_endpoint)',
        summary: '열린 UDP 소켓으로부터 메시지를 수신합니다.',
        category: 'Socket Class',
        insertSnippet: 'Socket.ReceiveFrom(${1:input_buffer}, ${2:max_length}, ${3:remote_endpoint})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/Socket/receivefrom_sock.htm'
    },
    {
        name: 'Socket.ReceiveTimeout',
        kind: 'property',
        signature: 'Socket.ReceiveTimeout',
        summary: '데이터 수신을 대기하며 소켓이 블록되는 타임아웃(밀리초)을 설정하거나 반환합니다.',
        category: 'Socket Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/Socket/receivetimeout_sock.htm'
    },
    {
        name: 'Socket.RemoteEndPoint',
        kind: 'property',
        signature: 'Socket.RemoteEndPoint',
        summary: '활성 TCP 연결의 원격 엔드포인트 정보를 반환합니다.',
        category: 'Socket Class',
        returnType: 'IPEndPoint',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/Socket/remoteendpoint.htm'
    },
    {
        name: 'Socket.Send',
        kind: 'method',
        signature: 'Socket.Send(output_buffer, max_length)',
        summary: '열린 TCP 연결로 메시지를 전송합니다.',
        category: 'Socket Class',
        insertSnippet: 'Socket.Send(${1:output_buffer}, ${2:max_length})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/Socket/send_sock.htm'
    },
    {
        name: 'Socket.SendTimeout',
        kind: 'property',
        signature: 'Socket.SendTimeout',
        summary: '데이터 전송을 대기하며 소켓이 블록되는 타임아웃(밀리초)을 설정하거나 반환합니다.',
        category: 'Socket Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/Socket/sendtimeout_sock.htm'
    },
    {
        name: 'Socket.SendTo',
        kind: 'method',
        signature: 'Socket.SendTo(output_buffer, max_length, remote_endpoint)',
        summary: '열린 UDP 소켓으로 메시지를 전송합니다.',
        category: 'Socket Class',
        insertSnippet: 'Socket.SendTo(${1:output_buffer}, ${2:max_length}, ${3:remote_endpoint})',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/Socket/sendto_sock.htm'
    },
    // ── TcpClient Class ──
    {
        name: 'TcpClient.Client',
        kind: 'method',
        signature: 'TcpClient.Client()',
        summary: 'TcpClient 객체에 연결된 Socket 객체를 반환합니다.',
        category: 'TcpClient Class',
        returnType: 'Socket',
        insertSnippet: 'TcpClient.Client()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/TcpClient/client_tcpc.htm'
    },
    {
        name: 'TcpClient.Close',
        kind: 'method',
        signature: 'TcpClient.Close()',
        summary: 'TcpClient에 연결된 네트워크 연결을 닫습니다.',
        category: 'TcpClient Class',
        insertSnippet: 'TcpClient.Close()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/TcpClient/close_tcpc.htm'
    },
    // ── TcpListener Class ──
    {
        name: 'TcpListener.AcceptSocket',
        kind: 'method',
        signature: 'TcpListener.AcceptSocket()',
        summary: 'TCP 연결을 수락하고, 해당 연결에서 I/O를 수행할 새 Socket 객체를 반환합니다.',
        category: 'TcpListener Class',
        returnType: 'Socket',
        insertSnippet: 'TcpListener.AcceptSocket()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/TcpListener/accept_tcpl.htm'
    },
    {
        name: 'TcpListener.Close',
        kind: 'method',
        signature: 'TcpListener.Close()',
        summary: 'TcpListener에 연결된 네트워크 연결을 닫습니다.',
        category: 'TcpListener Class',
        insertSnippet: 'TcpListener.Close()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/TcpListener/close_tcpl.htm'
    },
    {
        name: 'TcpListener.Pending',
        kind: 'property',
        signature: 'TcpListener.Pending',
        summary: '대기 중인 TCP 연결 요청이 있는지를 나타내는 Boolean 값을 반환합니다.',
        category: 'TcpListener Class',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/TcpListener/pending_tcpl.htm'
    },
    {
        name: 'TcpListener.Start',
        kind: 'method',
        signature: 'TcpListener.Start()',
        summary: 'TCP 연결 요청에 대한 수신 대기를 시작합니다.',
        category: 'TcpListener Class',
        insertSnippet: 'TcpListener.Start()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/TcpListener/start_tcpl.htm'
    },
    {
        name: 'TcpListener.Stop',
        kind: 'method',
        signature: 'TcpListener.Stop()',
        summary: 'TCP 연결 요청에 대한 수신 대기를 중지합니다.',
        category: 'TcpListener Class',
        insertSnippet: 'TcpListener.Stop()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/TcpListener/stop_tcpl.htm'
    },
    // ── UdpClient Class ──
    {
        name: 'UdpClient.Client',
        kind: 'method',
        signature: 'UdpClient.Client()',
        summary: 'UdpClient 객체에 연결된 Socket 객체를 반환합니다.',
        category: 'UdpClient Class',
        returnType: 'Socket',
        insertSnippet: 'UdpClient.Client()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/UdpClient/client_udpc.htm'
    },
    {
        name: 'UdpClient.Close',
        kind: 'method',
        signature: 'UdpClient.Close()',
        summary: 'UdpClient에 연결된 네트워크 연결을 닫습니다.',
        category: 'UdpClient Class',
        insertSnippet: 'UdpClient.Close()',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/UdpClient/close_udpc.htm'
    },
];
/**
 * 내장 클래스 자체(멤버가 아닌 클래스 이름)에 대한 개요 문서.
 *
 * GPL Dictionary의 클래스 소개 페이지(예: Thread/threadintro.htm)에서 확인한 내용으로,
 * 호버에서 `Thread` 같은 클래스 이름 위에 표시한다. 생성자는 `New Thread(...)` 형태로만
 * 쓸 수 있어 `Class.Member` 멤버 목록에 넣을 수 없으므로 여기에 둔다.
 */
export interface GPLClassDoc {
    /** 클래스 이름 (GPL_DICTIONARY_ENTRIES의 `Class.Member` 접두부와 같은 이름). */
    name: string;
    summary: string;
    /** 값 표·매개변수 설명 등 추가 설명(마크다운). */
    details?: string;
    /** 생성자 구문. 없으면 인스턴스를 만들지 않는 정적 클래스. */
    constructorSignature?: string;
    constructorSummary?: string;
    sourceUrl: string;
}

export const GPL_CLASS_DOCS: GPLClassDoc[] = [
    {
        name: 'Thread',
        summary: '독립적인 스레드를 시작·정지하고 상태를 감시하는 클래스입니다. GPL 시스템은 각자 실행 스택을 가진 최대 64개의 스레드를 동시에 지원합니다.',
        details: [
            '각 스레드는 최대 1밀리초 동안 실행된 뒤 다음 실행 대기 스레드로 제어가 넘어갑니다.',
            '프로젝트 설정에서 지정한 main 프로시저가 먼저 실행되고, 그 안에서 다른 프로시저를 별도 스레드로 띄울 수 있습니다.',
            '',
            '**생성자 매개변수**',
            '',
            '| 매개변수 | 필수 | 설명 |',
            '| --- | --- | --- |',
            '| procedure_name | 필수 | 스레드가 실행할 프로시저 이름(String). Public이어야 하며, 클래스 안에 있으면 Public Shared여야 하고 `클래스명.프로시저명`으로 씁니다 |',
            '| project_name | 선택 | 프로시저가 들어 있는 프로젝트 이름(String). 생략하면 현재 프로젝트 |',
            '| thread_name | 선택 | 생성할 스레드의 이름(String). 생략하면 procedure_name |',
            '| stack_size | 선택 | 이 스레드에 할당할 스택 크기(KB). 0이거나 생략하면 프로젝트 기본값 |',
            '',
            '생성자는 이름만 기록할 뿐 실제 스레드를 만들지 않으므로, 프로시저나 프로젝트가 없어도 이 시점에는',
            '오류가 나지 않고 `Start`를 실행할 때 드러납니다.'
        ].join('\n'),
        constructorSignature: 'New Thread(procedure_name, project_name, thread_name, stack_size)',
        constructorSummary: '프로시저와 연결된 Thread 객체를 만듭니다. 이름만 기록하며 실제 스레드 생성은 Start에서 이뤄집니다.',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/threadintro.htm'
    },
    // ── 모션/로봇 (정적 클래스) ──────────────────────────────────────────────
    {
        name: 'Move',
        summary: '로봇에 동작 명령을 내리는 정적 클래스입니다. 위치 제어·속도 제어·토크 제어 동작을 지원합니다.',
        details: [
            '표준적인 위치 제어 동작은 **목적지**와 **동작 성능 규격** 두 가지를 인자로 받습니다. 보통 목적지는',
            'Location 객체로, 성능 규격은 Profile 객체로 지정합니다. Location은 목적지를 직교 좌표나 관절 좌표로',
            '표현하며 일부 Move 메서드가 사용하는 클리어런스 정보도 함께 담습니다. Profile은 직선 보간/관절 보간',
            '중 어느 경로를 따를지와 얼마나 빠르게 움직일지를 지정합니다.',
            '',
            '목적지를 지정하는 방식에 따라 메서드가 나뉩니다 — 목적지로 바로 이동(`Move.Loc`), 목적지의 클리어런스',
            '위치로 이동(`Move.Approach`), 직전 목적지 기준 상대 이동(`Move.Rel`), 단일 축 이동(`Move.OneAxis`).'
        ].join('\n'),
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/moveintro.htm'
    },
    {
        name: 'Robot',
        summary: '시스템에 구성된 각 로봇의 기능과 상태(현재 위치, 원점 복귀, 감속 정지, 베이스·툴 오프셋 등)에 접근하는 정적 클래스입니다.',
        details: [
            '이 클래스의 가장 중요한 역할은 **특정 로봇을 특정 스레드에 결속하는 것**입니다.',
            '',
            '- 읽기 전용 조작(예: 현재 위치 읽기)은 로봇을 명시하지 않으면 `Robot.Selected`로 지정된 로봇을 씁니다.',
            '- 로봇을 제어하거나 이동시키려면 먼저 `Robot.Attached`로 배타적 접근 권한을 얻어야 합니다.',
            '',
            'GPL 관례대로 산술 타입(Integer·Single·Double) 간 변환은 자동으로 이뤄지며, 결과는 대체로 Double로',
            '만들어진 뒤 필요에 따라 작은 타입으로 자동 변환됩니다(오버플로가 없는 한 오류가 나지 않습니다).'
        ].join('\n'),
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/robotintro.htm'
    },
    {
        name: 'Signal',
        summary: '제어기의 디지털·아날로그 입출력(I/O)에 접근하는 정적 클래스입니다. GPL 프로그램이 셀 안의 다른 장비와 동작을 맞추는 통로입니다.',
        details: [
            '디지털 I/O로는 피더·가공 장비 같은 다른 설비와 실행을 인터록하는 세마포어를 만들 수 있고,',
            '아날로그 I/O로는 힘·온도 센서 값을 읽어 실행 흐름을 바꿀 수 있습니다.',
            '',
            '멤버는 `Signal.DIO`(디지털)와 `Signal.AIO`(아날로그) 두 개뿐이며, 채널 번호로 읽고 씁니다.'
        ].join('\n'),
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Signal/signalintro.htm'
    },
    {
        name: 'Controller',
        summary: '제어기 전반의 기능(고전력 제어, E-Stop 로직, 파라미터 데이터베이스, 콘솔 명령 실행 등)에 접근하는 정적 클래스입니다.',
        details: [
            '이 클래스와 그 멤버는 **PreciseFlex 제어기 제품 전용**으로 정의된 것이며 다른 표준을 따르지 않습니다.',
            '`SleepTick`처럼 Basic 언어의 다른 수단으로도 비슷한 일을 할 수 있는 멤버도 있지만, 사용 편의나',
            '미묘하게 다른(중요한) 동작 때문에 별도로 제공됩니다.'
        ].join('\n'),
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/cntrlclassintro.htm'
    },
    // ── 위치/자세/동작 데이터 (인스턴스 객체) ───────────────────────────────
    {
        name: 'Location',
        summary: 'GPL에서 로봇과 부품의 위치·방향을 표현하는 기본 수단입니다. 대부분의 Move 메서드가 Location(목적지)과 Profile(성능)을 인자로 받습니다.',
        details: [
            '각 Location 객체는 Type 표시자, 위치와 방향, 안전하게 접근하기 위한 클리어런스 정보, 대상 로봇에',
            '고유한 구성(configuration) 정보를 담습니다.',
            '',
            'Type은 두 가지입니다.',
            '',
            '| Type | 값 | 저장 내용 |',
            '| --- | --- | --- |',
            '| Cartesian | 0 | X·Y·Z 변위와 Euler 각(Yaw·Pitch·Roll), 그리고 참조 프레임 객체를 가리키는 선택적 포인터 |',
            '| Angles | 1 | 각 축 위치의 배열 |',
            '',
            'Cartesian Location에서 X·Y·Z·Yaw·Pitch·Roll은 "참조 프레임에 대한 위치"(`PosWrtRef`)를 정의하며,',
            '"총 위치(total position)"는 `PosWrtRef`와 지정된 참조 프레임들을 합한 결과입니다. Angles Location에서',
            '"총 위치"는 축 위치 배열 자체를 뜻합니다.'
        ].join('\n'),
        constructorSignature: 'New Location',
        constructorSummary: '기본값으로 초기화된 Location 객체를 만듭니다(`Dim loc1 As New Location`).',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/locationintro.htm'
    },
    {
        name: 'Profile',
        summary: '한 번의 동작을 어떻게 수행할지를 지정하는 성능 파라미터(속도·가속·감속·인레인지 기준 등)를 담는 객체입니다.',
        details: [
            '기본 동작 명령 `Move.Loc`은 Location과 Profile 두 인자를 받습니다 — Location은 **어디로** 갈지,',
            'Profile은 **어떻게** 갈지를 정합니다.',
            '',
            '`New Profile`로 만들면 `Straight`는 False(관절 보간)로 초기화됩니다.'
        ].join('\n'),
        constructorSignature: 'New Profile',
        constructorSummary: '기본값으로 초기화된 Profile 객체를 만듭니다(`Dim pf1 As New Profile`).',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/profileintro.htm'
    },
    {
        name: 'RefFrame',
        summary: '참조 프레임 객체입니다. Location이 RefFrame을 기준으로 정의돼 있으면, 프레임의 위치·방향을 바꾸는 것만으로 연결된 모든 Location이 함께 조정됩니다.',
        details: [
            '주요 용도는 세 가지입니다.',
            '',
            '- **기준 평판**: 베이스 플레이트에 대한 상대 위치가 고정된 여러 부품을 집거나 놓을 때. 예를 들어 PCB가',
            '  장비에 들어오면 비전으로 위치·방향을 확인해 PCB 참조 프레임만 갱신하면, 실장할 모든 부품의 위치가',
            '  자동으로 보정됩니다.',
            '- **팔레트**: 격자로 배열된 샘플 트레이 등. 트레이 위치를 잡고 프레임을 갱신하면 `PalletNextPos`로',
            '  샘플 사이를 간단히 이동할 수 있습니다.',
            '- **컨베이어**: 움직이는 컨베이어 라인에 상대적인 위치를 지정해 컨베이어 트래킹을 구현합니다.'
        ].join('\n'),
        constructorSignature: 'New RefFrame',
        constructorSummary: '기본값으로 초기화된 RefFrame 객체를 만듭니다(`Dim belt1 As New RefFrame`).',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/refframeintro.htm'
    },
    {
        name: 'Latch',
        summary: '래치 입력으로 설정된 디지털 입력이 변할 때 캡처된 로봇·벨트 위치를 GPL 프로시저가 받아 가는 클래스입니다.',
        details: [
            '래치가 발생하면 그 시점의 시각과 로봇 축 위치를 담은 Latch 객체가 만들어져 큐에 들어갑니다. 로봇마다',
            '독립적인 큐가 있고 오래된 것이 앞에 오도록 시간순으로 유지되며, 한 로봇의 모든 축이 동시에 래치되므로',
            '로봇의 전체 위치와 방향을 얻을 수 있습니다.',
            '',
            '벨트는 보통 "encoder only" 로봇으로 구성된 특수한 로봇입니다. 여러 벨트·로봇을 하나의 래치 입력으로',
            '동시에, 또는 서로 다른 래치 입력으로 독립적으로 래치할 수 있고, 벨트·로봇 하나당 최대 12개의 래치',
            '입력을 쓸 수 있습니다.',
            '',
            '큐 접근용 `Latch.Count`·`Latch.Flush`·`Latch.Result`·`Latch.ThreadEvent`는 Shared 멤버이고,',
            '`Angle`·`Location`·`Signal`·`Timestamp`·`ErrorCode`는 `Latch.Result`가 돌려준 객체의 인스턴스',
            '멤버입니다. `Latch.ThreadEvent`로 큐에 스레드 이벤트를 걸어 두면 `Thread.WaitEvent`로 래치를',
            '효율적으로 기다릴 수 있습니다.'
        ].join('\n'),
        constructorSummary: '직접 생성하지 않습니다 — `Latch.Result`가 큐에서 꺼내 돌려주는 객체를 받아 씁니다(큐가 비면 Nothing).',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/latchintro.htm'
    },
    // ── 예외 처리 ───────────────────────────────────────────────────────────
    {
        name: 'Exception',
        summary: '실행 예외의 원인 정보를 담는 객체입니다. 예외가 발생하면 정보가 자동으로 저장되고 실행이 Catch 블록으로 분기합니다.',
        details: [
            'Exception 객체는 두 가지 형태를 가집니다(`RobotError` 프로퍼티로 구분).',
            '',
            '| 형태 | 담는 정보 |',
            '| --- | --- |',
            '| 일반(general) | 예외 종류를 나타내는 숫자 코드 + 성격을 추가로 알려 주는 `Qualifier` |',
            '| 로봇(robot) | 숫자 코드 + 관련된 로봇 번호(`RobotNum`)와 축 비트마스크(`Axis`) |',
            '',
            '`Throw`로 직접 예외를 낼 때는 `ErrorCode`를 반드시 음수로 설정해야 합니다(0이면 -807 "Invalid',
            'exception"이 발생). 애플리케이션 전용 코드로 -786(*Project generated error*)과',
            '-1038(*Project generated robot error*)이 예약돼 있습니다 — 제어기가 자동으로 내지 않는 코드입니다.'
        ].join('\n'),
        constructorSignature: 'New Exception',
        constructorSummary: '빈 Exception 객체를 만듭니다(`Dim exc1 As New Exception`). `Catch exc1`에 쓸 객체는 미리 만들어 둬야 합니다.',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Exception_Handling/exception_intro.htm'
    },
    // ── 기본 자료형·유틸리티 ────────────────────────────────────────────────
    {
        name: 'String',
        summary: 'String 변수를 다루는 프로퍼티·메서드 모음입니다. String도 내부적으로는 다른 내장 클래스와 같은 구조로 구현돼 있습니다.',
        details: [
            '같은 일을 두 갈래로 할 수 있습니다.',
            '',
            '- 고전적인 Basic 함수: `Len`, `Mid`, `InStr`, `LCase`, `UCase`, `Asc`, `Chr`, `Format` 등',
            '- String 변수의 프로퍼티·메서드: `String.Compare`, `문자열변수.Length`, `문자열변수.Substring` 등',
            '',
            'String과 수치값 사이의 변환은 `CStr`·`CDbl`·`CInt`·`Hex` 같은 함수로 합니다(Functions 절 참조).'
        ].join('\n'),
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/stringintro.htm'
    },
    {
        name: 'Math',
        summary: 'GPL에 내장된 산술·삼각 연산을 모아 둔 정적 클래스입니다. 편집 중 픽 리스트로 사용 가능한 연산을 한눈에 볼 수 있도록 메서드 형태로 제공됩니다.',
        details: [
            '산술 타입(Boolean·Integer·Single·Double) 간 변환은 자동이므로 입력 타입 조합별로 다른 메서드가',
            '필요하지 않습니다. 결과는 대체로 Double로 만들어지고 필요하면 작은 타입으로 자동 변환됩니다',
            '(수치 오버플로가 없는 한 오류가 나지 않습니다).'
        ].join('\n'),
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/mathintro.htm'
    },
    {
        name: 'Array',
        summary: '모든 타입의 배열 변수(String·Location·Integer 등)가 속하는 내장 클래스입니다. 이 클래스의 프로퍼티로 배열의 형태를 조회합니다.',
        details: [
            '**하한(lower bound)은 항상 0**이므로 한 차원의 원소 수는 `GetUpperBound`보다 1 큽니다.',
            '`Length`는 전체 차원을 통틀은 원소 수, `Rank`는 차원 수입니다.'
        ].join('\n'),
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Array/arrayintro.htm'
    },
    {
        name: 'Console',
        summary: 'GPL 콘솔로 간단히 출력하는 정적 클래스입니다. 진단용 출력에 씁니다.',
        details: [
            '**출력이 실제로 어디로 가는지는 `Start` 콘솔 명령의 `-event` 스위치에 달려 있습니다.**',
            '',
            '| `-event` | 출력 대상 |',
            '| --- | --- |',
            '| 없음 | 첫 번째 시리얼 포트 `/dev/com1` |',
            '| 있음 | GDE의 GPL Output 창 |'
        ].join('\n'),
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Console/consoleintro.htm'
    },
    // ── 파일/시리얼 I/O ─────────────────────────────────────────────────────
    {
        name: 'File',
        summary: '디스크 파일과 디렉터리를 관리하는 정적 클래스입니다. 파일 내용 읽기·쓰기는 StreamReader·StreamWriter가 담당합니다.',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/fileserialintro.htm'
    },
    {
        name: 'StreamReader',
        summary: '파일이나 시리얼 포트 장치를 열어 읽는 객체입니다. 파일과 시리얼 통신에 모두 적용됩니다.',
        details: [
            '`path`에 쓰는 이름 규칙입니다.',
            '',
            '| 경로 | 대상 |',
            '| --- | --- |',
            '| `/dev/com1`, `/dev/com2`, … | 로컬 시리얼 포트 |',
            '| `/dev/comrxy` | 원격 시리얼 포트(x=원격 장치 번호, y=그 장치의 포트 번호) |',
            '| `/ROMDISK/...` | 임시 파일 |',
            '| `/flash/...` | 영구 파일 |',
            '',
            '열기에 실패하면 생성자가 Exception을 던집니다.'
        ].join('\n'),
        constructorSignature: 'New StreamReader(path)',
        constructorSummary: 'StreamReader 객체를 만들면서 파일이나 장치를 읽기용으로 엽니다.',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamReader/construct_sr.htm'
    },
    {
        name: 'StreamWriter',
        summary: '파일이나 시리얼 포트 장치를 열어 쓰는 객체입니다. 파일과 시리얼 통신에 모두 적용됩니다.',
        details: [
            '`path` 규칙은 StreamReader와 같습니다(`/dev/com1`, `/ROMDISK`, `/flash`).',
            '',
            '`append`는 선택 인자입니다 — False이면 같은 이름의 기존 파일을 덮어쓰며 항상 새 파일을 만듭니다.',
            '',
            '`AutoFlush`는 시리얼 포트와 `/NVRAM` 장치에서 기본 활성, 그 밖의 장치에 있는 파일에서는 기본',
            '비활성입니다. 열기에 실패하면 Exception을 던집니다.'
        ].join('\n'),
        constructorSignature: 'New StreamWriter(path, append)',
        constructorSummary: 'StreamWriter 객체를 만들면서 파일이나 장치를 쓰기용으로 엽니다(`append`는 생략 가능).',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/construct_sw.htm'
    },
    // ── 네트워킹 ────────────────────────────────────────────────────────────
    {
        name: 'IPEndPoint',
        summary: 'IP 주소와 포트 번호의 조합(엔드포인트)을 담는 객체입니다. 네트워크에서 컴퓨터와 프로세스를 함께 특정합니다.',
        details: [
            '두 매개변수 모두 선택입니다.',
            '',
            '| 매개변수 | 생략하면 |',
            '| --- | --- |',
            '| IP_address (`"nnn.nnn.nnn.nnn"`) | 빈 문자열이나 생략 시 모든 주소와 일치하는 와일드카드 |',
            '| port_number (0~65536) | 포트 번호를 자동 할당 |'
        ].join('\n'),
        constructorSignature: 'New IPEndPoint(IP_address, port_number)',
        constructorSummary: 'IP 엔드포인트 객체를 만들고 필요하면 주소·포트를 초기화합니다.',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/IPEndPoint/construct_ipe.htm'
    },
    {
        name: 'Socket',
        summary: '대부분의 네트워크 I/O의 기반이 되는 객체입니다. 기본적인 송수신 메서드를 담고 있습니다.',
        details: [
            '`New Socket`으로 직접 만들지 않습니다 — `TcpClient.Client`, `UdpClient.Client`,',
            '`TcpListener.AcceptSocket`이 돌려주는 Socket 객체를 받아 씁니다.'
        ].join('\n'),
        constructorSummary: '직접 생성하지 않습니다 — TcpClient·TcpListener·UdpClient에서 얻습니다.',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/networkintro.htm'
    },
    {
        name: 'TcpClient',
        summary: 'TCP 클라이언트를 구현하는 객체입니다. 생성 시 하부 Socket도 함께 만들어집니다.',
        details: [
            '`endpoint`는 선택 인자입니다. 지정하면 원격 서버로 연결 요청을 즉시 보내고, 생략하면 I/O 전에',
            '이 클라이언트의 Socket에 대해 `Connect`를 호출해야 합니다.'
        ].join('\n'),
        constructorSignature: 'New TcpClient(endpoint)',
        constructorSummary: 'TcpClient 객체를 만들고, endpoint를 주면 원격 TCP 서버로 연결을 요청합니다.',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/TcpClient/construct_tcpc.htm'
    },
    {
        name: 'TcpListener',
        summary: 'TCP 서버를 구현하는 객체입니다. 지정한 포트로 들어오는 연결을 받습니다.',
        details: [
            '생성만으로는 대기가 시작되지 않습니다 — `Start` 메서드를 호출해야 연결을 듣기 시작합니다.',
            '',
            '`endpoint`의 IP 주소는 무시됩니다(제어기의 IP는 하나뿐). 포트 번호만 의미가 있습니다.'
        ].join('\n'),
        constructorSignature: 'New TcpListener(endpoint)',
        constructorSummary: 'TcpListener 객체와 하부 Socket을 만듭니다(대기 시작은 Start).',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/TcpListener/construct_tcpl.htm'
    },
    {
        name: 'UdpClient',
        summary: 'UDP 통신의 서버·클라이언트 양쪽을 구현하는 객체입니다. 생성 시 하부 Socket도 함께 만들어집니다.',
        details: [
            '`endpoint`는 선택 인자이고 그 IP 주소는 무시됩니다(제어기의 IP는 하나뿐). 포트가 0이 아니면 해당',
            '포트로 온 데이터그램만 받습니다. 생성만으로는 네트워크 I/O가 발생하지 않습니다.'
        ].join('\n'),
        constructorSignature: 'New UdpClient(endpoint)',
        constructorSummary: 'UDP 통신용 UdpClient 객체와 하부 Socket을 만듭니다.',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/UdpClient/construct_udpc.htm'
    },
    {
        name: 'Modbus',
        summary: '로컬 이더넷에 연결된 MODBUS/TCP 슬레이브 장치에 마스터로 접근하는 객체입니다.',
        details: [
            'MODBUS/TCP는 산업 현장에서 지능형 장치 사이의 디지털·아날로그 I/O와 레지스터 데이터를 주고받는 데',
            '널리 쓰이는 사실상의 개방 표준입니다.',
            '',
            '슬레이브로의 연결은 필요할 때 자동으로 만들어집니다. 응답 대기 시간은 `Timeout`(밀리초)으로',
            '조절하며, 시간이 지나면 예외가 발생합니다.'
        ].join('\n'),
        constructorSignature: 'New Modbus(endpoint)',
        constructorSummary: 'MODBUS 연결용 객체를 만들고 대상 주소를 지정합니다(`Dim mb As New Modbus(ep)`, ep는 IPEndPoint).',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Modbus/modbusintro.htm'
    },
    // ── 비전 ────────────────────────────────────────────────────────────────
    {
        name: 'Vision',
        summary: 'PreciseVision 머신 비전 시스템과의 통신을 관리하는 객체입니다.',
        details: [
            '연결을 위한 별도 메서드는 없습니다 — `Process`·`Result`·`ResultCount`를 실행하면 GPL이 비전',
            '시스템으로의 연결을 자동으로 맺습니다. 연결을 끊을 때는 `Disconnect`를 씁니다.'
        ].join('\n'),
        constructorSignature: 'New Vision',
        constructorSummary: '빈 Vision 객체를 만듭니다. 이 시점에는 PreciseVision과 통신하지 않습니다.',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/visionintro.htm'
    },
    {
        name: 'VisResult',
        summary: '비전 툴 하나가 낸 결과 한 건을 담는 객체입니다.',
        details: [
            '보통 직접 만들지 않고 `Vision` 객체의 `Result` 메서드가 돌려주는 객체를 받아 씁니다.',
            '위치·방향은 `Loc`(Location 객체)으로, 수치 정보 배열은 `Info`/`InfoCount`로 읽습니다.'
        ].join('\n'),
        constructorSignature: 'New VisResult',
        constructorSummary: '빈 VisResult 객체를 만듭니다. 보통은 `vision_object.Result`로 얻으므로 직접 만들 일은 드뭅니다.',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/visionintro.htm'
    },
    // ── XML ─────────────────────────────────────────────────────────────────
    {
        name: 'XmlDoc',
        summary: 'XML 문서 전체를 담는 DOM 트리의 최상위를 다루는 객체입니다. 문서를 메모리로 읽어들이거나 파일로 저장하는 등 문서 단위 작업을 담당합니다.',
        details: [
            'GPL의 XML 클래스는 XML 텍스트 문서를 제어기 메모리 안의 트리 구조로 변환해 다룹니다. 트리는',
            'DOM(Document Object Model) Core Interfaces의 부분집합으로 구성됩니다.',
            '',
            'XML 문서 하나당 XmlDoc 객체는 정확히 하나이며(포인터는 여럿일 수 있음), XmlDoc 객체 없이는 DOM',
            '트리가 존재할 수 없습니다.',
            '',
            '`XmlDoc.LoadFile`·`XmlDoc.LoadString`은 새 문서 트리 객체를 자동으로 만들므로, `New XmlDoc`은',
            'GPL 안에서 문서를 새로 만들 때만 필요합니다.'
        ].join('\n'),
        constructorSignature: 'New XmlDoc(document_name)',
        constructorSummary: '지정한 이름의 최상위 섹션을 가진 새 XML 문서 트리를 만듭니다(특수문자 불가).',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/XmlDoc/construct_xmldoc.htm'
    },
    {
        name: 'XmlNode',
        summary: 'DOM 문서 트리의 개별 노드를 가리키는 객체입니다. 노드 데이터·프로퍼티 접근과 트리 구조에서의 노드 추가·삭제를 담당합니다.',
        details: [
            'XmlNode 객체는 DOM 노드를 **가리키기만 하고 담고 있지 않습니다.** 따라서 노드가 DOM 트리에 속해',
            '있는 한, XmlNode 객체를 만들거나 없애도 하부 DOM 노드는 영향을 받지 않습니다.',
            '',
            '노드 객체는 `XmlDoc.CreateNode`나 `XmlDoc.DocumentElement`, 그리고 `FirstChild`·`LastChild`·',
            '`ParentNode`·`NextSibling` 같은 탐색 메서드로 얻습니다.'
        ].join('\n'),
        constructorSummary: '직접 생성하지 않습니다 — `XmlDoc.CreateNode`·`XmlDoc.DocumentElement`나 탐색 메서드로 얻습니다.',
        sourceUrl: 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/xmlintro.htm'
    }
];
