import React, { useEffect, useState } from 'react';
import { KeyRound, Eye, EyeOff, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setInterval(() => {
      setRetryAfter(prev => {
        const next = prev - 1;
        if (next <= 0) {
          setError('');
          return 0;
        }
        setError(`Слишком много попыток. Попробуйте через ${next} секунд.`);
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAfter > 0]);

  const blocked = retryAfter > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blocked) return;
    if (!password.trim()) {
      setError('Введите пароль доступа');
      return;
    }
    setLoading(true);
    setError('');
    const result = await login(password);
    setLoading(false);
    if (!result.ok) {
      if (result.retryAfter && result.retryAfter > 0) {
        setRetryAfter(result.retryAfter);
        setError(result.error || `Слишком много попыток. Попробуйте через ${result.retryAfter} секунд.`);
      } else {
        setError(result.error || 'Неверный пароль');
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#d8eaf8] via-[#eaf3fb] to-[#f6f9fc] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white/95 border border-sky-100 shadow-xl rounded-2xl p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 bg-gradient-to-tr from-sky-600 to-indigo-600 rounded-xl flex items-center justify-center mb-4 shadow-xs">
            <div className="w-5 h-5 border-2 border-white rotate-45 rounded-xs"></div>
          </div>
          <h1 className="text-lg font-extrabold text-slate-900 tracking-tight">
            Панель управления отделом контента
          </h1>
          <p className="text-xs text-slate-500 mt-1.5">
            Введите пароль доступа, чтобы продолжить
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Пароль доступа"
              value={password}
              onChange={e => {
                setPassword(e.target.value);
                if (!blocked) setError('');
              }}
              autoFocus
              disabled={blocked}
              className="w-full pl-10 pr-10 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white transition-all disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
              aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs flex items-center gap-2 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || blocked}
            className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-sky-200 flex items-center justify-center gap-1.5"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            <span>{blocked ? `Подождите ${retryAfter} с` : loading ? 'Вход...' : 'Войти'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
