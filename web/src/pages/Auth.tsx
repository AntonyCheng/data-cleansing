import { useState } from "react";
import { Sparkles } from "lucide-react";
import { login, type AuthUser } from "../lib/api";

// 公开注册已关闭（后端 POST /api/auth/register 会返回 403），账号由管理员在「设置」里开通，
// 所以这里只有登录，没有注册入口。
export default function Auth({
  onAuthed,
  notice,
}: {
  onAuthed: (user: AuthUser) => void;
  notice?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // 初值取自外部提示（比如"登录状态已失效，请重新登录"）
  const [error, setError] = useState(notice ?? "");

  async function submit() {
    setError("");
    if (!email.trim() || !password.trim()) {
      setError("请填写邮箱和密码。");
      return;
    }
    setBusy(true);
    try {
      onAuthed(await login(email.trim(), password));
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <a className="brand" href="#tasks">
          <span className="brand-mark">
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path
                d="M8 7v18M24 7L13 16l11 9M13 11v10"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>
            KData<small>STUDIO</small>
          </span>
        </a>
        <h1>登录工作区</h1>
        <p className="auth-lede">登录后继续你的数据任务、清洗规则和数据服务。账号由管理员开通。</p>
        <label className="field">
          邮箱
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>
        <label className="field">
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••"
            autoComplete="current-password"
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary auth-submit" disabled={busy} onClick={submit}>
          <Sparkles size={16} />
          {busy ? "处理中…" : "登录"}
        </button>
      </div>
    </div>
  );
}
