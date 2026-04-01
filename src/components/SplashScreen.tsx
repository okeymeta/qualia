type SplashScreenProps = {
  progressLabel: string;
};

export function SplashScreen({ progressLabel }: SplashScreenProps) {
  return (
    <div className="qualia-splash">
      <div className="qualia-splash__grid" />
      <div className="qualia-splash__frame">
        <div className="qualia-splash__header">
          <span>QUALIA</span>
          <span>OKEYMETA LTD</span>
        </div>
        <div className="qualia-splash__core">
          <div className="qualia-splash__signal" />
          <p className="qualia-splash__eyebrow">Remote Intelligence Workplace</p>
          <h1 className="qualia-splash__title">Operator systems loading.</h1>
          <p className="qualia-splash__copy">
            Intake, verification, review, payroll, and compliance surfaces are being prepared for authenticated work.
          </p>
        </div>
        <div className="qualia-splash__footer">
          <div className="qualia-splash__status">
            <span className="qualia-splash__dot" />
            <span>{progressLabel}</span>
          </div>
          <div className="qualia-splash__bar">
            <div className="qualia-splash__barFill" />
          </div>
        </div>
      </div>
    </div>
  );
}
