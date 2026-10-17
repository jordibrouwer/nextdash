<?php
/**
 * Adds the /compare/ page, drawn by the Compare template (page-compare.php,
 * facts in inc/compare.php). Run inside the WordPress container:
 *
 *   docker cp add-compare-page.php <container>:/tmp/acp.php
 *   docker exec -e ND_HOST=nextdash.cc [-e ND_PUBLISH=1] <container> php /tmp/acp.php
 *
 * A draft unless ND_PUBLISH=1; a page that already exists is left alone.
 */

$_SERVER['HTTP_HOST'] = getenv( 'ND_HOST' ) ?: 'localhost';
chdir( '/var/www/html' );
require '/var/www/html/wp-load.php';

if ( get_page_by_path( 'compare' ) ) {
	echo "compare: exists, left alone\n";
	exit( 0 );
}
$id = wp_insert_post(
	array(
		'post_type'     => 'page',
		'post_status'   => getenv( 'ND_PUBLISH' ) ? 'publish' : 'draft',
		'post_name'     => 'compare',
		'post_title'    => 'How nextDash compares',
		'post_content'  => '',
		'page_template' => 'page-compare.php',
		'post_excerpt'  => 'nextDash next to Homarr, Homepage, Glance, Dashy, Heimdall and Homer: what each does, and where they differ.',
	),
	true
);
echo is_wp_error( $id ) ? 'compare: ' . $id->get_error_message() . "\n" : "compare: added (#$id)\n";
