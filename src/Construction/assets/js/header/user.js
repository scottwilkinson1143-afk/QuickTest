function user(app){
    app.createCube({
        "qInitialDataFetch": [
            {
                "qHeight": 10,
                "qWidth": 3,
            }
        ],
        "qDimensions": [
            {
                "qDef": {
                    "qFieldDefs": [
                        "Username"
                    ]
                },
                "qNullSuppression": false,
                "qOtherTotalSpec": {
                    "qOtherMode": "OTHER_OFF",
                    "qSuppressOther": true,
                    "qOtherSortMode": "OTHER_SORT_DESCENDING",
                    "qOtherCounted": {
                        "qv": "5"
                    },
                    "qOtherLimitMode": "OTHER_GE_LIMIT"
                }
            },
            
        ],
        "qMeasures": [
            {
                "qDef": {
                    "qDef": "='$(vLoginUser)'",
               }
            },
            {
                "qDef": {
                    "qDef": "='$(vUsernameProfile)'",
               }
            }

        ],
        "qSuppressZero": false,
        "qSuppressMissing": false,
        "qMode": "S",
        "qInterColumnSortOrder": [],
        "qStateName": "$"
    }, function userProfile(reply){
            //console.log(reply); //used for development
            const userProfile = reply.qHyperCube.qDataPages[0].qMatrix[0][0].qText;
            const loginUser = reply.qHyperCube.qDataPages[0].qMatrix[0][1].qText;
            const username = reply.qHyperCube.qDataPages[0].qMatrix[0][2].qText;

            $('#userProfile').empty().append($.gravatar(loginUser));

            if($('.gravatarImg').attr('src') == 'https://secure.gravatar.com/avatar/aa9f43162b29a85d9d4b8d7fb1f19782.jpg?'){
                $("#userProfile").attr('class', 'userProfile');
                $("#userProfile").html(userProfile);
            }

            // Display name in the top-bar profile chip and welcome banner -
            // this was fetched (vUsernameProfile) but never used anywhere.
            if (username) {
                $('.user-display-name').text(username);
            }
        });
}