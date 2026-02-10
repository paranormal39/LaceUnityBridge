using System.Collections;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;

/// <summary>
/// Editor utility script to create the Midnight Wallet UI at runtime.
/// Attach this to an empty GameObject and it will create the full UI hierarchy.
/// 
/// Alternatively, you can manually create the UI in the Editor and assign
/// references to MidnightBridge directly.
/// </summary>
public class MidnightUISetup : MonoBehaviour
{
    [Header("Settings")]
    [Tooltip("If true, creates UI automatically on Awake")]
    public bool createOnAwake = true;

    [Header("Styling")]
    public Color backgroundColor = new Color(0.1f, 0.1f, 0.15f, 1f);
    public Color panelColor = new Color(0.15f, 0.15f, 0.2f, 0.95f);
    public Color buttonColor = new Color(0.3f, 0.5f, 0.9f, 1f);
    public Color textColor = Color.white;
    public Color addressColor = new Color(0.5f, 0.8f, 0.5f, 1f);

    [Header("Counter Configuration")]
    [Tooltip("Blockfrost Project ID for Preprod. Leave empty to set at runtime.")]
    public string blockfrostProjectId = "";
    
    [Tooltip("Script address of the Aiken counter contract")]
    public string counterScriptAddress = "addr_test1wq0666pyk48q4v2zgjgdd4fuzn3xg2lzhsvueduvjxjuksqc7yh2n";

    private void Awake()
    {
        if (createOnAwake)
        {
            CreateMidnightUI();
        }
    }

    /// <summary>
    /// Creates the complete Midnight wallet connection UI.
    /// </summary>
    public void CreateMidnightUI()
    {
        // Create Canvas
        GameObject canvasObj = new GameObject("MidnightCanvas");
        Canvas canvas = canvasObj.AddComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvas.sortingOrder = 100;

        CanvasScaler scaler = canvasObj.AddComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1920, 1080);
        scaler.matchWidthOrHeight = 0.5f;

        canvasObj.AddComponent<GraphicRaycaster>();

        // Create EventSystem if one doesn't exist (required for UI input)
        if (FindObjectOfType<EventSystem>() == null)
        {
            GameObject eventSystemObj = new GameObject("EventSystem");
            eventSystemObj.AddComponent<EventSystem>();
            eventSystemObj.AddComponent<StandaloneInputModule>();
            Debug.Log("[MidnightUISetup] Created EventSystem for UI input");
        }

        // Create background panel (larger to fit send transaction UI)
        GameObject panelObj = CreatePanel(canvasObj.transform, "WalletPanel", panelColor);
        RectTransform panelRect = panelObj.GetComponent<RectTransform>();
        panelRect.anchorMin = new Vector2(0.5f, 0.5f);
        panelRect.anchorMax = new Vector2(0.5f, 0.5f);
        panelRect.sizeDelta = new Vector2(550, 920);
        panelRect.anchoredPosition = Vector2.zero;

        // Create title
        GameObject titleObj = CreateText(panelObj.transform, "Title", "Lace Wallet", 32, TextAnchor.MiddleCenter);
        RectTransform titleRect = titleObj.GetComponent<RectTransform>();
        titleRect.anchorMin = new Vector2(0, 1);
        titleRect.anchorMax = new Vector2(1, 1);
        titleRect.pivot = new Vector2(0.5f, 1);
        titleRect.sizeDelta = new Vector2(0, 50);
        titleRect.anchoredPosition = new Vector2(0, -10);

        // Create status text
        GameObject statusObj = CreateText(panelObj.transform, "StatusText", "Detecting wallet...", 18, TextAnchor.MiddleCenter);
        RectTransform statusRect = statusObj.GetComponent<RectTransform>();
        statusRect.anchorMin = new Vector2(0, 1);
        statusRect.anchorMax = new Vector2(1, 1);
        statusRect.pivot = new Vector2(0.5f, 1);
        statusRect.sizeDelta = new Vector2(0, 30);
        statusRect.anchoredPosition = new Vector2(0, -60);
        Text statusText = statusObj.GetComponent<Text>();

        // Create address row container
        GameObject addressRowObj = new GameObject("AddressRow");
        addressRowObj.transform.SetParent(panelObj.transform, false);
        RectTransform addressRowRect = addressRowObj.AddComponent<RectTransform>();
        addressRowRect.anchorMin = new Vector2(0, 1);
        addressRowRect.anchorMax = new Vector2(1, 1);
        addressRowRect.pivot = new Vector2(0.5f, 1);
        addressRowRect.sizeDelta = new Vector2(-40, 35);
        addressRowRect.anchoredPosition = new Vector2(0, -95);

        // Create address text (clickable area)
        GameObject addressObj = CreateText(addressRowObj.transform, "AddressText", "", 14, TextAnchor.MiddleLeft);
        RectTransform addressRect = addressObj.GetComponent<RectTransform>();
        addressRect.anchorMin = new Vector2(0, 0);
        addressRect.anchorMax = new Vector2(0.8f, 1);
        addressRect.offsetMin = Vector2.zero;
        addressRect.offsetMax = Vector2.zero;
        Text addressText = addressObj.GetComponent<Text>();
        addressText.color = addressColor;

        // Create copy button
        GameObject copyBtnObj = CreateButton(addressRowObj.transform, "CopyButton", "Copy", new Color(0.4f, 0.4f, 0.5f, 1f));
        RectTransform copyBtnRect = copyBtnObj.GetComponent<RectTransform>();
        copyBtnRect.anchorMin = new Vector2(0.82f, 0);
        copyBtnRect.anchorMax = new Vector2(1, 1);
        copyBtnRect.offsetMin = Vector2.zero;
        copyBtnRect.offsetMax = Vector2.zero;
        Button copyButton = copyBtnObj.GetComponent<Button>();
        copyBtnObj.GetComponentInChildren<Text>().fontSize = 14;

        // Create connect button
        GameObject connectBtnObj = CreateButton(panelObj.transform, "ConnectButton", "Connect Lace", buttonColor);
        RectTransform connectBtnRect = connectBtnObj.GetComponent<RectTransform>();
        connectBtnRect.anchorMin = new Vector2(0.5f, 1);
        connectBtnRect.anchorMax = new Vector2(0.5f, 1);
        connectBtnRect.pivot = new Vector2(0.5f, 1);
        connectBtnRect.sizeDelta = new Vector2(180, 45);
        connectBtnRect.anchoredPosition = new Vector2(0, -140);
        Button connectButton = connectBtnObj.GetComponent<Button>();
        Text connectButtonText = connectBtnObj.GetComponentInChildren<Text>();

        // === BALANCE DISPLAY SECTION ===
        
        // Network text (shows which network: mainnet, preprod, preview, testnet)
        GameObject networkObj = CreateText(panelObj.transform, "NetworkText", "Network: --", 14, TextAnchor.MiddleCenter);
        RectTransform networkRect = networkObj.GetComponent<RectTransform>();
        networkRect.anchorMin = new Vector2(0, 1);
        networkRect.anchorMax = new Vector2(1, 1);
        networkRect.pivot = new Vector2(0.5f, 1);
        networkRect.sizeDelta = new Vector2(0, 25);
        networkRect.anchoredPosition = new Vector2(0, -190);
        Text networkText = networkObj.GetComponent<Text>();
        networkText.color = new Color(0.7f, 0.7f, 0.8f, 1f); // Gray initially

        // Balance text (main native balance)
        GameObject balanceObj = CreateText(panelObj.transform, "BalanceText", "Balance: --", 20, TextAnchor.MiddleCenter);
        RectTransform balanceRect = balanceObj.GetComponent<RectTransform>();
        balanceRect.anchorMin = new Vector2(0, 1);
        balanceRect.anchorMax = new Vector2(1, 1);
        balanceRect.pivot = new Vector2(0.5f, 1);
        balanceRect.sizeDelta = new Vector2(0, 35);
        balanceRect.anchoredPosition = new Vector2(0, -215);
        Text balanceText = balanceObj.GetComponent<Text>();
        balanceText.color = new Color(0.4f, 0.9f, 0.4f, 1f); // Green for balance

        // Token list container (for other tokens on the side)
        GameObject tokenListObj = new GameObject("TokenListContainer");
        tokenListObj.transform.SetParent(panelObj.transform, false);
        RectTransform tokenListRect = tokenListObj.AddComponent<RectTransform>();
        tokenListRect.anchorMin = new Vector2(1, 0.5f);
        tokenListRect.anchorMax = new Vector2(1, 1);
        tokenListRect.pivot = new Vector2(0, 0.5f);
        tokenListRect.sizeDelta = new Vector2(180, 0);
        tokenListRect.anchoredPosition = new Vector2(20, -50);
        
        // Add vertical layout group for token list
        UnityEngine.UI.VerticalLayoutGroup tokenLayout = tokenListObj.AddComponent<UnityEngine.UI.VerticalLayoutGroup>();
        tokenLayout.childAlignment = TextAnchor.UpperLeft;
        tokenLayout.spacing = 5;
        tokenLayout.childControlHeight = false;
        tokenLayout.childControlWidth = true;
        tokenLayout.childForceExpandHeight = false;
        tokenLayout.childForceExpandWidth = true;

        // Token list title
        GameObject tokenTitleObj = CreateText(tokenListObj.transform, "TokenListTitle", "Other Tokens:", 14, TextAnchor.MiddleLeft);
        RectTransform tokenTitleRect = tokenTitleObj.GetComponent<RectTransform>();
        tokenTitleRect.sizeDelta = new Vector2(180, 20);
        Text tokenTitleText = tokenTitleObj.GetComponent<Text>();
        tokenTitleText.color = new Color(0.7f, 0.7f, 0.8f, 1f);

        // === SEND TRANSACTION SECTION ===
        
        // Divider line
        GameObject dividerObj = CreatePanel(panelObj.transform, "Divider", new Color(0.3f, 0.3f, 0.4f, 1f));
        RectTransform dividerRect = dividerObj.GetComponent<RectTransform>();
        dividerRect.anchorMin = new Vector2(0, 1);
        dividerRect.anchorMax = new Vector2(1, 1);
        dividerRect.pivot = new Vector2(0.5f, 1);
        dividerRect.sizeDelta = new Vector2(-40, 2);
        dividerRect.anchoredPosition = new Vector2(0, -240);

        // Send section title
        GameObject sendTitleObj = CreateText(panelObj.transform, "SendTitle", "Send Transaction", 20, TextAnchor.MiddleCenter);
        RectTransform sendTitleRect = sendTitleObj.GetComponent<RectTransform>();
        sendTitleRect.anchorMin = new Vector2(0, 1);
        sendTitleRect.anchorMax = new Vector2(1, 1);
        sendTitleRect.pivot = new Vector2(0.5f, 1);
        sendTitleRect.sizeDelta = new Vector2(0, 35);
        sendTitleRect.anchoredPosition = new Vector2(0, -255);

        // Recipient label
        GameObject recipientLabelObj = CreateText(panelObj.transform, "RecipientLabel", "Recipient Address:", 14, TextAnchor.MiddleLeft);
        RectTransform recipientLabelRect = recipientLabelObj.GetComponent<RectTransform>();
        recipientLabelRect.anchorMin = new Vector2(0, 1);
        recipientLabelRect.anchorMax = new Vector2(1, 1);
        recipientLabelRect.pivot = new Vector2(0.5f, 1);
        recipientLabelRect.sizeDelta = new Vector2(-40, 25);
        recipientLabelRect.anchoredPosition = new Vector2(0, -295);

        // Recipient input field
        GameObject recipientInputObj = CreateInputField(panelObj.transform, "RecipientInput", "Enter recipient address...");
        RectTransform recipientInputRect = recipientInputObj.GetComponent<RectTransform>();
        recipientInputRect.anchorMin = new Vector2(0, 1);
        recipientInputRect.anchorMax = new Vector2(1, 1);
        recipientInputRect.pivot = new Vector2(0.5f, 1);
        recipientInputRect.sizeDelta = new Vector2(-40, 35);
        recipientInputRect.anchoredPosition = new Vector2(0, -325);
        InputField recipientInput = recipientInputObj.GetComponent<InputField>();

        // Amount label
        GameObject amountLabelObj = CreateText(panelObj.transform, "AmountLabel", "Amount (lovelace):", 14, TextAnchor.MiddleLeft);
        RectTransform amountLabelRect = amountLabelObj.GetComponent<RectTransform>();
        amountLabelRect.anchorMin = new Vector2(0, 1);
        amountLabelRect.anchorMax = new Vector2(1, 1);
        amountLabelRect.pivot = new Vector2(0.5f, 1);
        amountLabelRect.sizeDelta = new Vector2(-40, 25);
        amountLabelRect.anchoredPosition = new Vector2(0, -365);

        // Amount input field
        GameObject amountInputObj = CreateInputField(panelObj.transform, "AmountInput", "1000000 (1 ADA)");
        RectTransform amountInputRect = amountInputObj.GetComponent<RectTransform>();
        amountInputRect.anchorMin = new Vector2(0, 1);
        amountInputRect.anchorMax = new Vector2(1, 1);
        amountInputRect.pivot = new Vector2(0.5f, 1);
        amountInputRect.sizeDelta = new Vector2(-40, 35);
        amountInputRect.anchoredPosition = new Vector2(0, -395);
        InputField amountInput = amountInputObj.GetComponent<InputField>();
        amountInput.contentType = InputField.ContentType.IntegerNumber;

        // Transaction status text
        GameObject txStatusObj = CreateText(panelObj.transform, "TxStatusText", "", 14, TextAnchor.MiddleCenter);
        RectTransform txStatusRect = txStatusObj.GetComponent<RectTransform>();
        txStatusRect.anchorMin = new Vector2(0, 1);
        txStatusRect.anchorMax = new Vector2(1, 1);
        txStatusRect.pivot = new Vector2(0.5f, 1);
        txStatusRect.sizeDelta = new Vector2(-40, 25);
        txStatusRect.anchoredPosition = new Vector2(0, -435);
        Text txStatusText = txStatusObj.GetComponent<Text>();
        txStatusText.color = new Color(1f, 0.8f, 0.3f, 1f);

        // Send button
        GameObject sendBtnObj = CreateButton(panelObj.transform, "SendButton", "Send", new Color(0.2f, 0.7f, 0.3f, 1f));
        RectTransform sendBtnRect = sendBtnObj.GetComponent<RectTransform>();
        sendBtnRect.anchorMin = new Vector2(0.5f, 1);
        sendBtnRect.anchorMax = new Vector2(0.5f, 1);
        sendBtnRect.pivot = new Vector2(0.5f, 1);
        sendBtnRect.sizeDelta = new Vector2(150, 45);
        sendBtnRect.anchoredPosition = new Vector2(0, -470);
        Button sendButton = sendBtnObj.GetComponent<Button>();

        // === TAB BUTTONS ===
        float tabY = -525f;
        
        // Tab divider
        GameObject tabDividerObj = CreatePanel(panelObj.transform, "TabDivider", new Color(0.3f, 0.3f, 0.4f, 1f));
        RectTransform tabDividerRect = tabDividerObj.GetComponent<RectTransform>();
        tabDividerRect.anchorMin = new Vector2(0, 1);
        tabDividerRect.anchorMax = new Vector2(1, 1);
        tabDividerRect.pivot = new Vector2(0.5f, 1);
        tabDividerRect.sizeDelta = new Vector2(-40, 2);
        tabDividerRect.anchoredPosition = new Vector2(0, tabY);

        // Tab buttons row
        GameObject tabRow = new GameObject("TabRow");
        tabRow.transform.SetParent(panelObj.transform, false);
        RectTransform tabRowRect = tabRow.AddComponent<RectTransform>();
        tabRowRect.anchorMin = new Vector2(0.5f, 1);
        tabRowRect.anchorMax = new Vector2(0.5f, 1);
        tabRowRect.pivot = new Vector2(0.5f, 1);
        tabRowRect.sizeDelta = new Vector2(340, 40);
        tabRowRect.anchoredPosition = new Vector2(0, tabY - 5);

        Color activeTabColor = new Color(0.3f, 0.5f, 0.9f, 1f);
        Color inactiveTabColor = new Color(0.2f, 0.2f, 0.3f, 1f);

        GameObject counterTabBtnObj = CreateButton(tabRow.transform, "CounterTabBtn", "Counter", activeTabColor);
        RectTransform counterTabRect = counterTabBtnObj.GetComponent<RectTransform>();
        counterTabRect.anchorMin = new Vector2(0, 0);
        counterTabRect.anchorMax = new Vector2(0.48f, 1);
        counterTabRect.offsetMin = Vector2.zero;
        counterTabRect.offsetMax = Vector2.zero;
        Button counterTabButton = counterTabBtnObj.GetComponent<Button>();
        counterTabBtnObj.GetComponentInChildren<Text>().fontSize = 16;
        Image counterTabImage = counterTabBtnObj.GetComponent<Image>();

        GameObject daoTabBtnObj = CreateButton(tabRow.transform, "DaoTabBtn", "DAO", inactiveTabColor);
        RectTransform daoTabRect = daoTabBtnObj.GetComponent<RectTransform>();
        daoTabRect.anchorMin = new Vector2(0.52f, 0);
        daoTabRect.anchorMax = new Vector2(1, 1);
        daoTabRect.offsetMin = Vector2.zero;
        daoTabRect.offsetMax = Vector2.zero;
        Button daoTabButton = daoTabBtnObj.GetComponent<Button>();
        daoTabBtnObj.GetComponentInChildren<Text>().fontSize = 16;
        Image daoTabImage = daoTabBtnObj.GetComponent<Image>();

        float contentY = tabY - 50f; // -575

        // === COUNTER TAB CONTENT ===
        GameObject counterTabContent = new GameObject("CounterTabContent");
        counterTabContent.transform.SetParent(panelObj.transform, false);
        RectTransform counterTabContentRect = counterTabContent.AddComponent<RectTransform>();
        counterTabContentRect.anchorMin = new Vector2(0, 0);
        counterTabContentRect.anchorMax = new Vector2(1, 1);
        counterTabContentRect.offsetMin = Vector2.zero;
        counterTabContentRect.offsetMax = Vector2.zero;

        // Counter status text
        GameObject counterStatusObj = CreateText(counterTabContent.transform, "CounterStatusText", "Ready", 12, TextAnchor.MiddleCenter);
        RectTransform counterStatusRect = counterStatusObj.GetComponent<RectTransform>();
        counterStatusRect.anchorMin = new Vector2(0, 1);
        counterStatusRect.anchorMax = new Vector2(1, 1);
        counterStatusRect.pivot = new Vector2(0.5f, 1);
        counterStatusRect.sizeDelta = new Vector2(0, 18);
        counterStatusRect.anchoredPosition = new Vector2(0, contentY);
        Text counterStatusText = counterStatusObj.GetComponent<Text>();
        counterStatusText.color = new Color(0.6f, 0.6f, 0.7f, 1f);

        // Counter value text
        GameObject counterValueObj = CreateText(counterTabContent.transform, "CounterText", "Counter: --", 24, TextAnchor.MiddleCenter);
        RectTransform counterValueRect = counterValueObj.GetComponent<RectTransform>();
        counterValueRect.anchorMin = new Vector2(0, 1);
        counterValueRect.anchorMax = new Vector2(1, 1);
        counterValueRect.pivot = new Vector2(0.5f, 1);
        counterValueRect.sizeDelta = new Vector2(0, 30);
        counterValueRect.anchoredPosition = new Vector2(0, contentY - 20);
        Text counterText = counterValueObj.GetComponent<Text>();
        counterText.color = new Color(0.3f, 0.8f, 1f, 1f);

        // Counter buttons row
        GameObject counterButtonsRow = new GameObject("CounterButtonsRow");
        counterButtonsRow.transform.SetParent(counterTabContent.transform, false);
        RectTransform counterButtonsRect = counterButtonsRow.AddComponent<RectTransform>();
        counterButtonsRect.anchorMin = new Vector2(0.5f, 1);
        counterButtonsRect.anchorMax = new Vector2(0.5f, 1);
        counterButtonsRect.pivot = new Vector2(0.5f, 1);
        counterButtonsRect.sizeDelta = new Vector2(340, 35);
        counterButtonsRect.anchoredPosition = new Vector2(0, contentY - 55);

        GameObject refreshCounterBtnObj = CreateButton(counterButtonsRow.transform, "RefreshCounterButton", "Refresh", new Color(0.2f, 0.5f, 0.7f, 1f));
        RectTransform refreshCounterBtnRect = refreshCounterBtnObj.GetComponent<RectTransform>();
        refreshCounterBtnRect.anchorMin = new Vector2(0, 0);
        refreshCounterBtnRect.anchorMax = new Vector2(0.48f, 1);
        refreshCounterBtnRect.offsetMin = Vector2.zero;
        refreshCounterBtnRect.offsetMax = Vector2.zero;
        Button refreshCounterButton = refreshCounterBtnObj.GetComponent<Button>();
        refreshCounterBtnObj.GetComponentInChildren<Text>().fontSize = 14;

        GameObject incrementCounterBtnObj = CreateButton(counterButtonsRow.transform, "IncrementCounterButton", "Increment (+1)", new Color(0.6f, 0.3f, 0.7f, 1f));
        RectTransform incrementCounterBtnRect = incrementCounterBtnObj.GetComponent<RectTransform>();
        incrementCounterBtnRect.anchorMin = new Vector2(0.52f, 0);
        incrementCounterBtnRect.anchorMax = new Vector2(1, 1);
        incrementCounterBtnRect.offsetMin = Vector2.zero;
        incrementCounterBtnRect.offsetMax = Vector2.zero;
        Button incrementCounterButton = incrementCounterBtnObj.GetComponent<Button>();
        incrementCounterBtnObj.GetComponentInChildren<Text>().fontSize = 14;

        // === DAO TAB CONTENT ===
        GameObject daoTabContent = new GameObject("DaoTabContent");
        daoTabContent.transform.SetParent(panelObj.transform, false);
        RectTransform daoTabContentRect = daoTabContent.AddComponent<RectTransform>();
        daoTabContentRect.anchorMin = new Vector2(0, 0);
        daoTabContentRect.anchorMax = new Vector2(1, 1);
        daoTabContentRect.offsetMin = Vector2.zero;
        daoTabContentRect.offsetMax = Vector2.zero;
        daoTabContent.SetActive(false); // Start hidden

        float dy = contentY; // starting Y offset for DAO content

        // Proposals list area
        GameObject proposalsObj = CreateText(daoTabContent.transform, "ProposalsText", "Click 'Refresh' to load proposals...", 12, TextAnchor.UpperLeft);
        RectTransform proposalsRect = proposalsObj.GetComponent<RectTransform>();
        proposalsRect.anchorMin = new Vector2(0, 1);
        proposalsRect.anchorMax = new Vector2(1, 1);
        proposalsRect.pivot = new Vector2(0.5f, 1);
        proposalsRect.sizeDelta = new Vector2(-40, 70);
        proposalsRect.anchoredPosition = new Vector2(0, dy);
        Text proposalsText = proposalsObj.GetComponent<Text>();
        proposalsText.color = new Color(0.8f, 0.8f, 0.9f, 1f);
        dy -= 72;

        // Refresh proposals button
        GameObject refreshDaoBtnObj = CreateButton(daoTabContent.transform, "RefreshDaoBtn", "Refresh Proposals", new Color(0.2f, 0.5f, 0.7f, 1f));
        RectTransform refreshDaoBtnRect = refreshDaoBtnObj.GetComponent<RectTransform>();
        refreshDaoBtnRect.anchorMin = new Vector2(0.5f, 1);
        refreshDaoBtnRect.anchorMax = new Vector2(0.5f, 1);
        refreshDaoBtnRect.pivot = new Vector2(0.5f, 1);
        refreshDaoBtnRect.sizeDelta = new Vector2(180, 28);
        refreshDaoBtnRect.anchoredPosition = new Vector2(0, dy);
        Button refreshDaoButton = refreshDaoBtnObj.GetComponent<Button>();
        refreshDaoBtnObj.GetComponentInChildren<Text>().fontSize = 12;
        dy -= 32;

        // --- Proposal selector: [<] "#0 Title (Y:1 N:0 A:0)" [>] ---
        GameObject selectorRow = new GameObject("SelectorRow");
        selectorRow.transform.SetParent(daoTabContent.transform, false);
        RectTransform selectorRowRect = selectorRow.AddComponent<RectTransform>();
        selectorRowRect.anchorMin = new Vector2(0.5f, 1);
        selectorRowRect.anchorMax = new Vector2(0.5f, 1);
        selectorRowRect.pivot = new Vector2(0.5f, 1);
        selectorRowRect.sizeDelta = new Vector2(480, 30);
        selectorRowRect.anchoredPosition = new Vector2(0, dy);

        GameObject prevBtnObj = CreateButton(selectorRow.transform, "PrevBtn", "<", new Color(0.3f, 0.3f, 0.45f, 1f));
        RectTransform prevBtnRect = prevBtnObj.GetComponent<RectTransform>();
        prevBtnRect.anchorMin = new Vector2(0, 0); prevBtnRect.anchorMax = new Vector2(0.08f, 1);
        prevBtnRect.offsetMin = Vector2.zero; prevBtnRect.offsetMax = Vector2.zero;
        Button prevButton = prevBtnObj.GetComponent<Button>();
        prevBtnObj.GetComponentInChildren<Text>().fontSize = 16;

        GameObject selectedLabelObj = CreateText(selectorRow.transform, "SelectedLabel", "No proposals loaded", 13, TextAnchor.MiddleCenter);
        RectTransform selectedLabelRect = selectedLabelObj.GetComponent<RectTransform>();
        selectedLabelRect.anchorMin = new Vector2(0.1f, 0); selectedLabelRect.anchorMax = new Vector2(0.9f, 1);
        selectedLabelRect.offsetMin = Vector2.zero; selectedLabelRect.offsetMax = Vector2.zero;
        Text selectedLabelText = selectedLabelObj.GetComponent<Text>();
        selectedLabelText.color = new Color(0.3f, 0.8f, 1f, 1f);

        GameObject nextBtnObj = CreateButton(selectorRow.transform, "NextBtn", ">", new Color(0.3f, 0.3f, 0.45f, 1f));
        RectTransform nextBtnRect = nextBtnObj.GetComponent<RectTransform>();
        nextBtnRect.anchorMin = new Vector2(0.92f, 0); nextBtnRect.anchorMax = new Vector2(1, 1);
        nextBtnRect.offsetMin = Vector2.zero; nextBtnRect.offsetMax = Vector2.zero;
        Button nextButton = nextBtnObj.GetComponent<Button>();
        nextBtnObj.GetComponentInChildren<Text>().fontSize = 16;
        dy -= 34;

        // Vote buttons row
        GameObject voteRow = new GameObject("VoteRow");
        voteRow.transform.SetParent(daoTabContent.transform, false);
        RectTransform voteRowRect = voteRow.AddComponent<RectTransform>();
        voteRowRect.anchorMin = new Vector2(0.5f, 1);
        voteRowRect.anchorMax = new Vector2(0.5f, 1);
        voteRowRect.pivot = new Vector2(0.5f, 1);
        voteRowRect.sizeDelta = new Vector2(380, 32);
        voteRowRect.anchoredPosition = new Vector2(0, dy);

        GameObject yesBtn = CreateButton(voteRow.transform, "YesBtn", "Vote Yes", new Color(0.2f, 0.7f, 0.3f, 1f));
        RectTransform yesBtnRect = yesBtn.GetComponent<RectTransform>();
        yesBtnRect.anchorMin = new Vector2(0, 0); yesBtnRect.anchorMax = new Vector2(0.32f, 1);
        yesBtnRect.offsetMin = Vector2.zero; yesBtnRect.offsetMax = Vector2.zero;
        Button yesButton = yesBtn.GetComponent<Button>();
        yesBtn.GetComponentInChildren<Text>().fontSize = 13;

        GameObject noBtn = CreateButton(voteRow.transform, "NoBtn", "Vote No", new Color(0.8f, 0.2f, 0.2f, 1f));
        RectTransform noBtnRect = noBtn.GetComponent<RectTransform>();
        noBtnRect.anchorMin = new Vector2(0.34f, 0); noBtnRect.anchorMax = new Vector2(0.66f, 1);
        noBtnRect.offsetMin = Vector2.zero; noBtnRect.offsetMax = Vector2.zero;
        Button noButton = noBtn.GetComponent<Button>();
        noBtn.GetComponentInChildren<Text>().fontSize = 13;

        GameObject appealBtn = CreateButton(voteRow.transform, "AppealBtn", "Appeal", new Color(0.8f, 0.6f, 0.1f, 1f));
        RectTransform appealBtnRect = appealBtn.GetComponent<RectTransform>();
        appealBtnRect.anchorMin = new Vector2(0.68f, 0); appealBtnRect.anchorMax = new Vector2(1, 1);
        appealBtnRect.offsetMin = Vector2.zero; appealBtnRect.offsetMax = Vector2.zero;
        Button appealButton = appealBtn.GetComponent<Button>();
        appealBtn.GetComponentInChildren<Text>().fontSize = 13;
        dy -= 36;

        // DAO status text
        GameObject daoStatusObj = CreateText(daoTabContent.transform, "DaoStatusText", "", 11, TextAnchor.MiddleCenter);
        RectTransform daoStatusRect = daoStatusObj.GetComponent<RectTransform>();
        daoStatusRect.anchorMin = new Vector2(0, 1);
        daoStatusRect.anchorMax = new Vector2(1, 1);
        daoStatusRect.pivot = new Vector2(0.5f, 1);
        daoStatusRect.sizeDelta = new Vector2(-40, 18);
        daoStatusRect.anchoredPosition = new Vector2(0, dy);
        Text daoStatusText = daoStatusObj.GetComponent<Text>();
        daoStatusText.color = new Color(1f, 0.8f, 0.3f, 1f);
        dy -= 22;

        // --- Create Proposal section ---
        GameObject createDivObj = CreatePanel(daoTabContent.transform, "CreateDivider", new Color(0.3f, 0.3f, 0.4f, 1f));
        RectTransform createDivRect = createDivObj.GetComponent<RectTransform>();
        createDivRect.anchorMin = new Vector2(0, 1); createDivRect.anchorMax = new Vector2(1, 1);
        createDivRect.pivot = new Vector2(0.5f, 1);
        createDivRect.sizeDelta = new Vector2(-40, 1);
        createDivRect.anchoredPosition = new Vector2(0, dy);
        dy -= 4;

        GameObject createLabelObj = CreateText(daoTabContent.transform, "CreateLabel", "Create Proposal", 15, TextAnchor.MiddleCenter);
        RectTransform createLabelRect = createLabelObj.GetComponent<RectTransform>();
        createLabelRect.anchorMin = new Vector2(0, 1); createLabelRect.anchorMax = new Vector2(1, 1);
        createLabelRect.pivot = new Vector2(0.5f, 1);
        createLabelRect.sizeDelta = new Vector2(0, 22);
        createLabelRect.anchoredPosition = new Vector2(0, dy);
        dy -= 24;

        // Title input
        GameObject proposalTitleInput = CreateInputField(daoTabContent.transform, "ProposalTitleInput", "Proposal title...");
        RectTransform ptRect = proposalTitleInput.GetComponent<RectTransform>();
        ptRect.anchorMin = new Vector2(0, 1); ptRect.anchorMax = new Vector2(1, 1);
        ptRect.pivot = new Vector2(0.5f, 1);
        ptRect.sizeDelta = new Vector2(-40, 28);
        ptRect.anchoredPosition = new Vector2(0, dy);
        InputField proposalTitleField = proposalTitleInput.GetComponent<InputField>();
        dy -= 32;

        // Description input
        GameObject proposalDescInput = CreateInputField(daoTabContent.transform, "ProposalDescInput", "Description...");
        RectTransform pdRect = proposalDescInput.GetComponent<RectTransform>();
        pdRect.anchorMin = new Vector2(0, 1); pdRect.anchorMax = new Vector2(1, 1);
        pdRect.pivot = new Vector2(0.5f, 1);
        pdRect.sizeDelta = new Vector2(-40, 28);
        pdRect.anchoredPosition = new Vector2(0, dy);
        InputField proposalDescField = proposalDescInput.GetComponent<InputField>();
        dy -= 32;

        // Create button
        GameObject createBtnObj = CreateButton(daoTabContent.transform, "CreateProposalBtn", "Create (2 ADA)", new Color(0.6f, 0.3f, 0.7f, 1f));
        RectTransform createBtnRect = createBtnObj.GetComponent<RectTransform>();
        createBtnRect.anchorMin = new Vector2(0.5f, 1); createBtnRect.anchorMax = new Vector2(0.5f, 1);
        createBtnRect.pivot = new Vector2(0.5f, 1);
        createBtnRect.sizeDelta = new Vector2(180, 32);
        createBtnRect.anchoredPosition = new Vector2(0, dy);
        Button createProposalButton = createBtnObj.GetComponent<Button>();
        createBtnObj.GetComponentInChildren<Text>().fontSize = 13;

        // === TAB SWITCHING LOGIC ===
        counterTabButton.onClick.AddListener(() => {
            counterTabContent.SetActive(true);
            daoTabContent.SetActive(false);
            counterTabImage.color = activeTabColor;
            daoTabImage.color = inactiveTabColor;
        });
        daoTabButton.onClick.AddListener(() => {
            counterTabContent.SetActive(false);
            daoTabContent.SetActive(true);
            counterTabImage.color = inactiveTabColor;
            daoTabImage.color = activeTabColor;
        });

        // Create MidnightBridge and wire up references
        GameObject bridgeObj = new GameObject("MidnightBridge");
        MidnightBridge bridge = bridgeObj.AddComponent<MidnightBridge>();
        bridge.statusText = statusText;
        bridge.addressText = addressText;
        bridge.connectButton = connectButton;
        bridge.connectButtonText = connectButtonText;
        bridge.copyAddressButton = copyButton;
        bridge.balanceText = balanceText;
        bridge.networkText = networkText;
        bridge.tokenListContainer = tokenListObj.transform;
        bridge.recipientInput = recipientInput;
        bridge.amountInput = amountInput;
        bridge.sendButton = sendButton;
        bridge.txStatusText = txStatusText;

        // Wire up button clicks
        connectButton.onClick.AddListener(bridge.OnConnectButtonClicked);
        copyButton.onClick.AddListener(bridge.OnCopyAddressClicked);
        sendButton.onClick.AddListener(bridge.OnSendButtonClicked);

        // Initially disable send UI until connected
        sendButton.interactable = false;
        recipientInput.interactable = false;
        amountInput.interactable = false;
        copyButton.interactable = false;

        // Create CounterReader and wire up references
        GameObject counterReaderObj = new GameObject("CounterReader");
        CounterReader counterReader = counterReaderObj.AddComponent<CounterReader>();
        counterReader.counterText = counterText;
        counterReader.counterStatusText = counterStatusText;
        counterReader.refreshButton = refreshCounterButton;
        
        // Configure counter reader with inspector values
        if (!string.IsNullOrEmpty(blockfrostProjectId))
        {
            counterReader.SetBlockfrostProjectId(blockfrostProjectId);
        }
        if (!string.IsNullOrEmpty(counterScriptAddress))
        {
            counterReader.SetScriptAddress(counterScriptAddress);
        }
        
        // Wire up refresh button
        refreshCounterButton.onClick.AddListener(counterReader.RefreshCounter);

        // Wire up increment button
        // Capture variables for lambda
        string scriptAddr = counterScriptAddress;
        string bfKey = blockfrostProjectId;
        incrementCounterButton.onClick.AddListener(() => {
            bridge.IncrementCounter(scriptAddr, bfKey);
        });

        // Auto-refresh counter after successful increment (with delay for block confirmation)
        bridge.OnCounterIncremented += (txHash) => {
            // Wait ~20 seconds for transaction to be included in a block, then refresh
            StartCoroutine(DelayedCounterRefresh(counterReader, 20f));
        };

        // Initially disable increment button until wallet connected
        incrementCounterButton.interactable = false;
        
        // Store reference to enable button when wallet connects
        Button incrementBtn = incrementCounterButton;
        
        // Use a polling approach to check connection status since MidnightBridge
        // doesn't expose a connection event directly from UI setup
        StartCoroutine(EnableIncrementButtonWhenConnected(bridge, incrementBtn));

        // === DAO WIRING ===
        Cardano.CardanoBridge.DaoProposal[] currentProposals = null;
        int selectedProposalIndex = 0;

        // Helper to update the selector label
        System.Action updateSelectorLabel = () => {
            if (currentProposals == null || currentProposals.Length == 0)
            {
                selectedLabelText.text = "No proposals loaded";
                selectedLabelText.color = new Color(0.5f, 0.5f, 0.6f, 1f);
                return;
            }
            var sp = currentProposals[selectedProposalIndex];
            selectedLabelText.text = $"#{selectedProposalIndex}/{currentProposals.Length - 1}  {sp.title}  (Y:{sp.yesCount} N:{sp.noCount} A:{sp.appealCount})";
            selectedLabelText.color = new Color(0.3f, 0.8f, 1f, 1f);
        };

        // Prev/Next buttons
        prevButton.onClick.AddListener(() => {
            if (currentProposals == null || currentProposals.Length == 0) return;
            selectedProposalIndex = (selectedProposalIndex - 1 + currentProposals.Length) % currentProposals.Length;
            updateSelectorLabel();
        });
        nextButton.onClick.AddListener(() => {
            if (currentProposals == null || currentProposals.Length == 0) return;
            selectedProposalIndex = (selectedProposalIndex + 1) % currentProposals.Length;
            updateSelectorLabel();
        });

        // Create CardanoBridge if it doesn't exist
        if (Cardano.CardanoBridge.Instance == null)
        {
            GameObject cardanoBridgeObj = new GameObject("CardanoBridge");
            cardanoBridgeObj.AddComponent<Cardano.CardanoBridge>();
        }

        // Pass Blockfrost key to CardanoBridge for DAO operations
        if (!string.IsNullOrEmpty(blockfrostProjectId))
        {
            Cardano.CardanoBridge.Instance.SetBlockfrostKey(blockfrostProjectId);
        }

        // Refresh proposals
        refreshDaoButton.onClick.AddListener(() => {
            daoStatusText.text = "Loading proposals...";
            daoStatusText.color = new Color(1f, 0.8f, 0.3f, 1f);
            Cardano.CardanoBridge.Instance.FetchDaoProposals();
        });

        // Handle proposals received
        Cardano.CardanoBridge.Instance.OnDaoProposalsReceived += (proposals) => {
            currentProposals = proposals;
            if (proposals == null || proposals.Length == 0)
            {
                proposalsText.text = "No proposals found.";
                selectedProposalIndex = 0;
                updateSelectorLabel();
                daoStatusText.text = "";
                return;
            }
            string display = "";
            for (int idx = 0; idx < proposals.Length; idx++)
            {
                var p = proposals[idx];
                display += $"#{idx} {p.title}  (Y:{p.yesCount} N:{p.noCount} A:{p.appealCount})\n";
            }
            proposalsText.text = display;
            if (selectedProposalIndex >= proposals.Length) selectedProposalIndex = 0;
            updateSelectorLabel();
            daoStatusText.text = proposals.Length + " proposal(s) loaded";
            daoStatusText.color = new Color(0.4f, 0.9f, 0.4f, 1f);
        };
        Cardano.CardanoBridge.Instance.OnDaoProposalsFailed += (err) => {
            daoStatusText.text = "Error: " + err;
            daoStatusText.color = new Color(1f, 0.3f, 0.3f, 1f);
        };

        // Vote buttons — use selectedProposalIndex
        yesButton.onClick.AddListener(() => {
            if (currentProposals == null || currentProposals.Length == 0) { daoStatusText.text = "No proposals loaded"; return; }
            var p = currentProposals[selectedProposalIndex];
            daoStatusText.text = $"Voting YES on #{selectedProposalIndex} '{p.title}'...";
            daoStatusText.color = new Color(1f, 0.8f, 0.3f, 1f);
            Cardano.CardanoBridge.Instance.VoteOnDaoProposal(p.txHash, p.txIndex, "yes");
        });
        noButton.onClick.AddListener(() => {
            if (currentProposals == null || currentProposals.Length == 0) { daoStatusText.text = "No proposals loaded"; return; }
            var p = currentProposals[selectedProposalIndex];
            daoStatusText.text = $"Voting NO on #{selectedProposalIndex} '{p.title}'...";
            daoStatusText.color = new Color(1f, 0.8f, 0.3f, 1f);
            Cardano.CardanoBridge.Instance.VoteOnDaoProposal(p.txHash, p.txIndex, "no");
        });
        appealButton.onClick.AddListener(() => {
            if (currentProposals == null || currentProposals.Length == 0) { daoStatusText.text = "No proposals loaded"; return; }
            var p = currentProposals[selectedProposalIndex];
            daoStatusText.text = $"Voting APPEAL on #{selectedProposalIndex} '{p.title}'...";
            daoStatusText.color = new Color(1f, 0.8f, 0.3f, 1f);
            Cardano.CardanoBridge.Instance.VoteOnDaoProposal(p.txHash, p.txIndex, "appeal");
        });

        // Vote result handlers
        Cardano.CardanoBridge.Instance.OnDaoVoteSuccess += (txHash) => {
            daoStatusText.text = "Vote submitted! Tx: " + txHash.Substring(0, 16) + "...";
            daoStatusText.color = new Color(0.4f, 0.9f, 0.4f, 1f);
            StartCoroutine(DelayedDaoRefresh(20f));
        };
        Cardano.CardanoBridge.Instance.OnDaoVoteFailed += (err) => {
            daoStatusText.text = "Vote failed: " + err;
            daoStatusText.color = new Color(1f, 0.3f, 0.3f, 1f);
        };

        // Create proposal
        createProposalButton.onClick.AddListener(() => {
            string t = proposalTitleField.text;
            string d = proposalDescField.text;
            if (string.IsNullOrEmpty(t)) { daoStatusText.text = "Enter a title"; return; }
            daoStatusText.text = "Creating proposal...";
            daoStatusText.color = new Color(1f, 0.8f, 0.3f, 1f);
            Cardano.CardanoBridge.Instance.CreateDaoProposal("unity-dao-v1", t, d);
        });
        Cardano.CardanoBridge.Instance.OnDaoProposalCreated += (txHash) => {
            daoStatusText.text = "Proposal created! Tx: " + txHash.Substring(0, 16) + "...";
            daoStatusText.color = new Color(0.4f, 0.9f, 0.4f, 1f);
            proposalTitleField.text = "";
            proposalDescField.text = "";
            StartCoroutine(DelayedDaoRefresh(20f));
        };
        Cardano.CardanoBridge.Instance.OnDaoProposalCreateFailed += (err) => {
            daoStatusText.text = "Create failed: " + err;
            daoStatusText.color = new Color(1f, 0.3f, 0.3f, 1f);
        };

        // Disable DAO buttons until wallet connected
        yesButton.interactable = false;
        noButton.interactable = false;
        appealButton.interactable = false;
        createProposalButton.interactable = false;
        proposalTitleField.interactable = false;
        proposalDescField.interactable = false;

        // Enable DAO buttons when wallet connects
        StartCoroutine(EnableDaoButtonsWhenConnected(bridge, new Button[] { yesButton, noButton, appealButton, createProposalButton }, new InputField[] { proposalTitleField, proposalDescField }));

        Debug.Log("[MidnightUISetup] UI created successfully (with Counter + DAO tabs)");
    }

    private GameObject CreateInputField(Transform parent, string name, string placeholder)
    {
        GameObject obj = new GameObject(name);
        obj.transform.SetParent(parent, false);

        Image image = obj.AddComponent<Image>();
        image.color = new Color(0.1f, 0.1f, 0.15f, 1f);

        InputField inputField = obj.AddComponent<InputField>();

        // Create text component
        GameObject textObj = new GameObject("Text");
        textObj.transform.SetParent(obj.transform, false);
        Text text = textObj.AddComponent<Text>();
        text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        text.fontSize = 14;
        text.color = textColor;
        text.alignment = TextAnchor.MiddleLeft;
        text.supportRichText = false;

        RectTransform textRect = textObj.GetComponent<RectTransform>();
        textRect.anchorMin = Vector2.zero;
        textRect.anchorMax = Vector2.one;
        textRect.offsetMin = new Vector2(10, 0);
        textRect.offsetMax = new Vector2(-10, 0);

        // Create placeholder
        GameObject placeholderObj = new GameObject("Placeholder");
        placeholderObj.transform.SetParent(obj.transform, false);
        Text placeholderText = placeholderObj.AddComponent<Text>();
        placeholderText.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        placeholderText.fontSize = 14;
        placeholderText.fontStyle = FontStyle.Italic;
        placeholderText.color = new Color(0.5f, 0.5f, 0.5f, 0.7f);
        placeholderText.alignment = TextAnchor.MiddleLeft;
        placeholderText.text = placeholder;

        RectTransform placeholderRect = placeholderObj.GetComponent<RectTransform>();
        placeholderRect.anchorMin = Vector2.zero;
        placeholderRect.anchorMax = Vector2.one;
        placeholderRect.offsetMin = new Vector2(10, 0);
        placeholderRect.offsetMax = new Vector2(-10, 0);

        inputField.textComponent = text;
        inputField.placeholder = placeholderText;

        return obj;
    }

    private GameObject CreatePanel(Transform parent, string name, Color color)
    {
        GameObject obj = new GameObject(name);
        obj.transform.SetParent(parent, false);

        Image image = obj.AddComponent<Image>();
        image.color = color;

        return obj;
    }

    private GameObject CreateText(Transform parent, string name, string content, int fontSize, TextAnchor alignment)
    {
        GameObject obj = new GameObject(name);
        obj.transform.SetParent(parent, false);

        Text text = obj.AddComponent<Text>();
        text.text = content;
        text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        text.fontSize = fontSize;
        text.alignment = alignment;
        text.color = textColor;
        text.horizontalOverflow = HorizontalWrapMode.Wrap;
        text.verticalOverflow = VerticalWrapMode.Overflow;

        return obj;
    }

    private GameObject CreateButton(Transform parent, string name, string label, Color color)
    {
        GameObject obj = new GameObject(name);
        obj.transform.SetParent(parent, false);

        Image image = obj.AddComponent<Image>();
        image.color = color;

        Button button = obj.AddComponent<Button>();
        ColorBlock colors = button.colors;
        colors.normalColor = color;
        colors.highlightedColor = color * 1.1f;
        colors.pressedColor = color * 0.9f;
        colors.disabledColor = color * 0.5f;
        button.colors = colors;

        // Create button text
        GameObject textObj = new GameObject("Text");
        textObj.transform.SetParent(obj.transform, false);

        Text text = textObj.AddComponent<Text>();
        text.text = label;
        text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        text.fontSize = 20;
        text.alignment = TextAnchor.MiddleCenter;
        text.color = Color.white;

        RectTransform textRect = textObj.GetComponent<RectTransform>();
        textRect.anchorMin = Vector2.zero;
        textRect.anchorMax = Vector2.one;
        textRect.sizeDelta = Vector2.zero;

        return obj;
    }

    /// <summary>
    /// Coroutine to refresh counter after a delay (for block confirmation).
    /// </summary>
    private IEnumerator DelayedCounterRefresh(CounterReader counterReader, float delaySeconds)
    {
        Debug.Log($"[MidnightUISetup] Waiting {delaySeconds}s for block confirmation before refresh...");
        yield return new WaitForSeconds(delaySeconds);
        
        if (counterReader != null)
        {
            Debug.Log("[MidnightUISetup] Auto-refreshing counter after increment");
            counterReader.RefreshCounter();
        }
    }

    /// <summary>
    /// Coroutine to enable increment button when wallet connects.
    /// </summary>
    private IEnumerator EnableIncrementButtonWhenConnected(MidnightBridge bridge, Button incrementButton)
    {
        // Poll every second until connected
        while (bridge != null && !bridge.IsConnectedToWallet)
        {
            yield return new WaitForSeconds(1f);
        }
        
        if (incrementButton != null)
        {
            incrementButton.interactable = true;
            Debug.Log("[MidnightUISetup] Increment button enabled (wallet connected)");
        }
        
        // Continue monitoring for disconnection
        while (bridge != null)
        {
            yield return new WaitForSeconds(1f);
            if (incrementButton != null)
            {
                incrementButton.interactable = bridge.IsConnectedToWallet;
            }
        }
    }

    /// <summary>
    /// Coroutine to refresh DAO proposals after a delay (for block confirmation).
    /// </summary>
    private IEnumerator DelayedDaoRefresh(float delaySeconds)
    {
        Debug.Log($"[MidnightUISetup] Waiting {delaySeconds}s for block confirmation before DAO refresh...");
        yield return new WaitForSeconds(delaySeconds);
        
        if (Cardano.CardanoBridge.Instance != null)
        {
            Debug.Log("[MidnightUISetup] Auto-refreshing DAO proposals");
            Cardano.CardanoBridge.Instance.FetchDaoProposals();
        }
    }

    /// <summary>
    /// Coroutine to enable DAO buttons when wallet connects.
    /// </summary>
    private IEnumerator EnableDaoButtonsWhenConnected(MidnightBridge bridge, Button[] buttons, InputField[] inputs)
    {
        while (bridge != null && !bridge.IsConnectedToWallet)
        {
            yield return new WaitForSeconds(1f);
        }
        
        foreach (var btn in buttons)
        {
            if (btn != null) btn.interactable = true;
        }
        foreach (var input in inputs)
        {
            if (input != null) input.interactable = true;
        }
        Debug.Log("[MidnightUISetup] DAO buttons enabled (wallet connected)");
        
        // Continue monitoring for disconnection
        while (bridge != null)
        {
            yield return new WaitForSeconds(1f);
            bool connected = bridge.IsConnectedToWallet;
            foreach (var btn in buttons)
            {
                if (btn != null) btn.interactable = connected;
            }
            foreach (var input in inputs)
            {
                if (input != null) input.interactable = connected;
            }
        }
    }
}
