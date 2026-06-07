// Pentacles — a long-press detector for any uGUI element.
//
// Attach to a raycast-target object; after a short hold it fires once. Used for
// contextual tooltips (long-press a card to learn what it is). Coexists with a
// Button on the same object — the consumer can swallow the trailing click.

using System;
using UnityEngine;
using UnityEngine.EventSystems;

public class LongPress : MonoBehaviour, IPointerDownHandler, IPointerUpHandler, IPointerExitHandler
{
    public float Threshold = 0.5f;
    Action _onLongPress;
    float _downAt = -1f;
    bool _fired;

    public static LongPress Attach(GameObject go, Action onLongPress)
    {
        var lp = go.AddComponent<LongPress>();
        lp._onLongPress = onLongPress;
        return lp;
    }

    public void OnPointerDown(PointerEventData e) { _downAt = Time.unscaledTime; _fired = false; }
    public void OnPointerUp(PointerEventData e) { _downAt = -1f; }
    public void OnPointerExit(PointerEventData e) { _downAt = -1f; }

    void Update()
    {
        if (_downAt > 0f && !_fired && Time.unscaledTime - _downAt >= Threshold)
        {
            _fired = true; _downAt = -1f;
            _onLongPress?.Invoke();
        }
    }
}
