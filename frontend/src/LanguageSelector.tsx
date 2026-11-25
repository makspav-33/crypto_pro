export type TextLanguage = 'UA' | 'EN'

export default function LanguageSelector({ value, onChange }: { value: TextLanguage; onChange: (value: TextLanguage) => void }) {
  return <div className="language-choice"><span className="field-title" id="text-language-label">Мова тексту</span><div className="language-switch" role="group" aria-labelledby="text-language-label">{([['UA', 'Українська'], ['EN', 'Англійська']] as const).map(([code, label]) => <button key={code} type="button" aria-pressed={value === code} onClick={() => onChange(code)}><span className="language-code">{code}</span>{label}</button>)}</div></div>
}
