var config = {
    host: 'swi11.eu.qlikcloud.com',
    prefix: '/',
    port: 443,
    isSecure: true,
    webIntegrationId: 'GJxNrKWzqtRAth1KLmORkwQlacrCxtn5'
};

//Redirect to login if user is not logged in
async function login() {
    function isLoggedIn() {
        return fetch("https://"+config.host+"/api/v1/users/me", {
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'qlik-web-integration-id': config.webIntegrationId,
            },
        }).then(response => {
            return response.status === 200;
        });
    }
    return isLoggedIn().then(loggedIn =>{
        if (!loggedIn) {
            window.location.href = "https://"+config.host+
            "/login?qlik-web-integration-id=" + config.webIntegrationId +
            "&returnto=" + location.href;
            throw new Error('not logged in');
        }
    });
}
login().then(() => {
    require.config( {
        baseUrl: ( config.isSecure ? "https://" : "http://" ) + config.host +
        (config.port ? ":" + config.port : "") + config.prefix + "resources",
        webIntegrationId: config.webIntegrationId
    } );
    //Load js/qlik after authentication is successful
    require( ["js/qlik"], function ( qlik ) {
        qlik.on( "error", function ( error ) {
            $( '#popupText' ).append( error.message + "<br>" );
            $( '#popup' ).fadeIn( 1000 );
        } );
        $( "#closePopup" ).click( function () {
            $( '#popup' ).hide();
        } );
        //open apps -- inserted here --
        document.getElementById("id01").innerHTML = 'Initialising App....';
        const sessionAppFromApp = qlik.sessionAppFromApp("2649b403-fe69-43d9-9cc7-91b4ac7b2e6e", config);
        document.getElementById("id01").innerHTML = 'Reloading App....';
        qlik.theme.apply('Matrix');
        sessionAppFromApp.doReload().then((result)=>{
            if( result ){
                document.getElementById("id01").innerHTML = 'Retrieve Sheet....';
                sessionAppFromApp.getObject('QV01', 'tAwLnxh');
            } 
            else {
                console.log('Reload failed');
            }
        });
    } );
});