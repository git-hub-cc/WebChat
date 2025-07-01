移除影响div宽高的标签
移除大于20px的参数设置，比如--sidebar-width: 320px，仅作移除操作，不进行其它操作。
(?:(?:margin|padding)(?:-(?:top|right|bottom|left|block(?:-(?:start|end))?|inline(?:-(?:start|end))?))?|(?:min-|max-)?width|(?:min-|max-)?height|line-height)\s*:\s*[^;]+;

移除影响卡顿的标签，当有动画时，计算量太大
backdrop-filter